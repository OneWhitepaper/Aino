"""External behavior checks for the daily fixture; not exposed as task instructions."""
import argparse, concurrent.futures, io, json, sys, threading, time, unittest
from pathlib import Path
from types import SimpleNamespace

parser=argparse.ArgumentParser();parser.add_argument('workspace');args=parser.parse_args()
sys.path.insert(0,str(Path(args.workspace).resolve()))
import auth, billing, exports

class Token:
    def __init__(self,user_id,expires_at):self.user_id=user_id;self.expires_at=expires_at
    def verified_payload(self):return {'user_id':self.user_id,'expires_at':self.expires_at}

class SlowMembershipSet(set):
    # Real threads plus a slow lookup widen the overlap window; this is not a deterministic scheduler.
    def __contains__(self,item):
        present=super().__contains__(item)
        time.sleep(.02)
        return present

class DailyContracts(unittest.TestCase):
    def assert_rejected(self, operation):
        try:
            result=operation()
        except (PermissionError,ValueError,KeyError):
            return
        structured_error=isinstance(result,dict) and bool(result.get('error')) and not any(key in result for key in ('accounts','rows','payload','user','id'))
        self.assertTrue(result is None or result is False or structured_error, 'Rejected operation returned a success value')

    def test_access_control(self):
        users={'inactive':auth.User('inactive',False,'user'),'regular':auth.User('regular',True,'user'),'admin':auth.User('admin',True,'admin')}
        with self.subTest('active account with valid token can log in'):
            authenticated=auth.authenticate(Token('regular',time.time()+3600),users)
            user_id=authenticated.get('id') if isinstance(authenticated,dict) else getattr(authenticated,'id',None)
            self.assertEqual(user_id,'regular')
        with self.subTest('inactive account denied'):
            self.assert_rejected(lambda:auth.authenticate(Token('inactive',time.time()+3600),users))
        with self.subTest('expired token denied'):
            self.assert_rejected(lambda:auth.authenticate(Token('regular',time.time()-1),users))
        with self.subTest('request flag cannot grant admin'):
            req=SimpleNamespace(token=Token('regular',time.time()+3600),query={'admin':True})
            self.assert_rejected(lambda:auth.admin_report(req,users))
        with self.subTest('real admin needs no request flag'):
            req=SimpleNamespace(token=Token('admin',time.time()+3600),query={})
            self.assertEqual(auth.admin_report(req,users)['accounts'],len(users))

    def test_billing_boundaries(self):
        with self.subTest('overlapping duplicate event applied once'):
            ledger=billing.Ledger();ledger.events=SlowMembershipSet();barrier=threading.Barrier(2)
            def pay():barrier.wait(timeout=2);return ledger.payment('same-event','account',100)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                futures=[pool.submit(pay) for _ in range(2)]
                for f in futures:f.result(timeout=3)
            self.assertEqual(ledger.balances['account'],100)
            ledger.payment('same-event','account',100)
            self.assertEqual(ledger.balances['account'],100)
        with self.subTest('refund does not exceed payment'):
            ledger=billing.Ledger();ledger.payment('paid','account',100)
            try:ledger.refund('account',101)
            except (ValueError,PermissionError):pass
            self.assertGreaterEqual(ledger.balances['account'],0)
            self.assertLessEqual(ledger.balances['account'],100)
        with self.subTest('cumulative refunds do not exceed payment'):
            ledger=billing.Ledger();ledger.payment('paid-cumulative','account',100)
            ledger.refund('account',60)
            self.assertEqual(ledger.balances['account'],40)
            try:ledger.refund('account',60)
            except (ValueError,PermissionError,KeyError):pass
            self.assertGreaterEqual(ledger.balances['account'],0)
            self.assertLessEqual(ledger.balances['account'],40)
        with self.subTest('discount endpoints remain valid'):
            self.assertEqual(billing.discounted_price(1000,0),1000)
            self.assertEqual(billing.discounted_price(1000,100),0)
        with self.subTest('valid integer pricing and bounded discount'):
            self.assertEqual(billing.discounted_price(1000,20),800)
            self.assertIsInstance(billing.discounted_price(1000,20),int)
            for percent in (-1,101):
                try: result=billing.discounted_price(1000,percent)
                except (ValueError,TypeError):continue
                self.assertGreaterEqual(result,0);self.assertLessEqual(result,1000)
        with self.subTest('zero discount preserves a valid large integer amount exactly'):
            price_cents = 2**53 + 3
            result = billing.discounted_price(price_cents, 0)
            self.assertIsInstance(result, int)
            self.assertEqual(result, price_cents)

    def test_exports_isolation(self):
        exports.JOBS.clear();exports.CACHE.clear()
        rows=[{'tenant_id':'a','id':'visible','deleted':False},{'tenant_id':'a','id':'deleted-secret','deleted':True},{'tenant_id':'b','id':'foreign-secret','deleted':False}]
        job=exports.create_export('job','a',rows)
        with self.subTest('cold cache retains ownership check'):
            self.assert_rejected(lambda:exports.download_export(job,'b'))
        with self.subTest('deleted and foreign rows excluded'):
            payload=exports.download_export(job,'a')
            self.assertIn('visible',payload);self.assertNotIn('deleted-secret',payload);self.assertNotIn('foreign-secret',payload)
        with self.subTest('cache hit retains ownership check'):
            self.assert_rejected(lambda:exports.download_export(job,'b'))
        with self.subTest('concurrent job ID reuse never serves a previous tenant payload'):
            ready, release, armed = threading.Event(), threading.Event(), threading.Event()
            started, created, rejected = threading.Event(), threading.Event(), threading.Event()
            errors, replacement = [], {}

            class SlowRecord(dict):
                def __str__(self):
                    if armed.is_set():
                        ready.set()
                        if not release.wait(timeout=10):
                            raise TimeoutError('export audit serializer was not released')
                    return super().__str__()

            # Use public inputs and calls: a slow old download may overlap reuse of its job ID.
            # Eager or different serialization remains valid and need not call __str__ here.
            old_job = exports.create_export('overlap-job', 'a', [
                SlowRecord(tenant_id='a', id='old-tenant-a-secret', deleted=False)])
            armed.set()

            def old_download():
                try:
                    exports.download_export(old_job, 'a')
                except (PermissionError, KeyError):
                    pass  # An invalidated in-flight handle may fail closed after replacement.
                except Exception as exc:
                    errors.append(('old download', repr(exc)))
                finally:
                    ready.set()

            def reuse_job():
                started.set()
                try:
                    replacement['job'] = exports.create_export('overlap-job', 'b', [
                        {'tenant_id': 'b', 'id': 'new-tenant-b-visible', 'deleted': False}])
                except (PermissionError, ValueError, KeyError):
                    rejected.set()  # SPEC permits rejecting duplicate IDs instead of overwriting.
                except Exception as exc:
                    errors.append(('job reuse', repr(exc)))
                finally:
                    created.set()

            reader = threading.Thread(target=old_download, daemon=True)
            writer = threading.Thread(target=reuse_job, daemon=True)
            reader.start()
            try:
                self.assertTrue(ready.wait(timeout=5), 'old download did not reach the audit boundary')
                writer.start()
                self.assertTrue(started.wait(timeout=5), 'replacement worker did not start')
                # A correct common lock may block the writer until release; never require it to finish now.
                created.wait(timeout=2)
            finally:
                release.set()
                reader.join(timeout=5)
                if writer.ident is not None:
                    writer.join(timeout=5)
            self.assertFalse(reader.is_alive() or writer.is_alive(), 'export workers did not converge')
            self.assertEqual(errors, [])
            if rejected.is_set():
                self.assert_rejected(lambda: exports.download_export(old_job, 'b'))
            else:
                payload = exports.download_export(replacement['job'], 'b')
                self.assertNotIn('old-tenant-a-secret', payload)
                self.assertIn('new-tenant-b-visible', payload)

output=io.StringIO()
result=unittest.TextTestRunner(stream=output,verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(DailyContracts))
print(json.dumps({'tests_run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'successful':result.wasSuccessful(),'output':output.getvalue(),'limitations':['Payment concurrency uses real threads and a 20 ms membership delay; export reuse uses events around a slow public record serialization and allows a common lock to block until release. Different serializers may bypass that overlap, and scheduling windows do not establish a formal race-free proof.','Only the stated small-fixture behaviors are checked; this is not exhaustive validation of malformed inputs, every API shape, or production code.']}))
sys.exit(0 if result.wasSuccessful() else 1)

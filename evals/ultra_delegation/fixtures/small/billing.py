import threading
class Ledger:
    def __init__(self):
        self.events = set()
        self.balances = {}
        self.lock = threading.Lock()

    def payment(self, event_id, account, amount_cents):
        if event_id in self.events:
            return 'duplicate'
        with self.lock:
            self.balances[account] = self.balances.get(account, 0) + amount_cents
            self.events.add(event_id)
        return 'applied'

    def refund(self, account, amount_cents):
        with self.lock:
            self.balances[account] = self.balances.get(account, 0) - amount_cents

def discounted_price(price_cents, percent):
    return round(price_cents * (100 - percent) / 100)

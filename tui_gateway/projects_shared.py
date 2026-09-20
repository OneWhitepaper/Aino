"""Explicit source routing for the shared project index on the current backend."""
from __future__ import annotations

import os
from dataclasses import asdict, replace
from pathlib import Path

from gateway import hosted_rooms
from gateway.hosted_room_conversation_types import ProjectRef
from gateway.hosted_room_conversation_bindings import ConversationBindingError
from hermes_cli import projects_db
from hermes_cli.projects_shared import SharedProjectStore


def canonical_local_path(path):
    try:
        resolved = Path(path).expanduser().resolve(strict=True)
        if not resolved.is_dir():
            raise ValueError('project directory is unavailable')
    except OSError as exc:
        raise ConversationBindingError('project directory is unavailable') from exc
    return os.path.normcase(str(resolved))


class SharedProjects:
    def __init__(self, server):
        self.server = server
        self.install_id = hosted_rooms.local_authority_gateway_id()
        self.store = SharedProjectStore(getattr(server, '_conversation_db_path', None) or hosted_rooms.default_db_path())

    def _home(self, profile):
        try:
            return Path(self.server._profile_home(profile) or self.server._hermes_home)
        except OSError as exc:
            raise ConversationBindingError('project source Profile is unavailable') from exc

    def _environment(self, profile, environment='local'):
        if environment != 'local':
            raise ValueError('shared project execution environment is unavailable')
        from .session_conversation_binding import _validate_environment
        _validate_environment(self.server, self._home(profile), None, self.install_id)

    def validate_source(self, source):
        if isinstance(source, dict):
            source = ProjectRef(**source)
        if source.install_id != self.install_id:
            raise ValueError('project belongs to another installation')
        self._environment(source.registration_profile, source.execution_environment_id)
        db_path = self._home(source.registration_profile) / 'projects.db'
        if not db_path.is_file():
            raise ValueError('project source registration is unavailable')
        with projects_db.connect_closing(db_path) as conn:
            project = projects_db.get_project(conn, source.project_id)
        if project is None or project.archived or not project.primary_path:
            raise ValueError('project source registration is unavailable')
        canonical = canonical_local_path(project.primary_path)
        if canonical_local_path(source.cwd) != canonical:
            raise ValueError('project directory differs from its source registration')
        return replace(source, cwd=canonical), project

    def _index_source(self, profile, project):
        self._environment(profile)
        return self.store.register(install_id=self.install_id, environment_id='local',
            canonical_path=canonical_local_path(project.primary_path), registration_profile=profile,
            source_project_id=project.id, name=project.name)

    def _available(self, project):
        sources, names = [], []
        for source in project.sources:
            try:
                current, registered = self.validate_source(source)
            except (ValueError, OSError, ConversationBindingError):
                continue
            sources.append(current)
            names.append(registered.name)
        if not sources:
            return None
        return replace(project, sources=tuple(sources), name=names[0])

    def list(self):
        from hermes_cli.profiles import list_profiles
        unavailable = []
        for profile in list_profiles():
            path = self._home(profile.name) / 'projects.db'
            if not path.is_file():
                continue
            with projects_db.connect_closing(path) as conn:
                projects = projects_db.list_projects(conn)
            for project in projects:
                if not project.primary_path:
                    continue
                try:
                    self._index_source(profile.name, project)
                except (ValueError, OSError, ConversationBindingError) as exc:
                    unavailable.append({'registration_profile': profile.name, 'project_id': project.id, 'reason': str(exc)})
        projects = [available for project in self.store.list() if (available := self._available(project)) is not None]
        return {'projects': [asdict(project) for project in projects], 'available_environments': ['local'],
                'unavailable_sources': unavailable}

    def register(self, registration_profile, name, canonical_path, environment_id='local'):
        self._environment(registration_profile, environment_id)
        path = canonical_local_path(canonical_path)
        with projects_db.connect_closing(self._home(registration_profile) / 'projects.db') as conn:
            project = None
            for candidate in projects_db.list_projects(conn):
                if not candidate.primary_path:
                    continue
                try:
                    matches = canonical_local_path(candidate.primary_path) == path
                except (OSError, ValueError, ConversationBindingError):
                    continue
                if matches:
                    project = candidate
                    break
            if project is None:
                project_id = projects_db.create_project(conn, name=name, primary_path=path)
                project = projects_db.get_project(conn, project_id)
        indexed = self._index_source(registration_profile, project)
        return {'project': asdict(self._available(indexed))}

    def resolve(self, shared_project_id):
        project = self._available(self.store.resolve(shared_project_id))
        if project is None:
            raise ValueError('shared project has no available source')
        return {'project': asdict(project)}

    def mutate(self, shared_project_id, source, *, name=None, delete=False):
        supplied = ProjectRef(**source)
        project = self.store.resolve(shared_project_id)
        if supplied not in project.sources:
            raise ValueError('source does not belong to the shared project')
        current, _registered = self.validate_source(supplied)
        with projects_db.connect_closing(self._home(current.registration_profile) / 'projects.db') as conn:
            with projects_db.write_txn(conn):
                registered = projects_db.get_project(conn, current.project_id)
                if registered is None or registered.archived or canonical_local_path(registered.primary_path) != project.canonical_path:
                    raise ValueError('source changed before mutation')
                if delete:
                    conn.execute('DELETE FROM projects WHERE id=?', (registered.id,))
                else:
                    if not name or not name.strip():
                        raise ValueError('project name must not be empty')
                    conn.execute('UPDATE projects SET name=? WHERE id=?', (name.strip(), registered.id))
        # Keep the immutable source mapping for stale references; never reassign its identity.
        available = self._available(project)
        return {'project': asdict(available) if available is not None else None}


def annotate_profile_tree(server, store, projects, profile, home, install_id):
    """Retain authoritative sources while the legacy sidebar folds Profile trees."""
    from .session_conversation_binding import _validate_environment
    try:
        _validate_environment(server, home, None, install_id)
        local = True
    except ConversationBindingError:
        local = False
    path = Path(home) / 'projects.db'
    registrations = {}
    if path.is_file():
        with projects_db.connect_closing(path) as conn:
            registrations = {p.id: p for p in projects_db.list_projects(conn)}
    for node in projects:
        node['sources'] = []
        if not node.get('path'):
            continue
        # A remote path is opaque. Profile scoping prevents unrelated hosts from coalescing.
        node['_shared_merge_key'] = ('unavailable', profile, node['id'])
        if not local:
            continue
        try:
            canonical = canonical_local_path(node['path'])
        except (OSError, ValueError, ConversationBindingError):
            continue
        node['_shared_merge_key'] = (install_id, 'local', canonical)
        registered = registrations.get(node['id'])
        if registered is None or not registered.primary_path:
            continue
        try:
            indexed = store.register(install_id=install_id, environment_id='local',
                canonical_path=canonical, registration_profile=profile,
                source_project_id=registered.id, name=registered.name)
        except ValueError:
            continue
        node['shared_project_id'] = indexed.id
        node['sources'] = [asdict(source) for source in indexed.sources
                           if source.registration_profile == profile and source.project_id == registered.id]


def register(server):
    from tui_gateway.contracts.registry import METHODS, check_result
    from pydantic import ValidationError
    from .conversation_authority import request_owner_key
    def handler(suffix):
        def run(rid, params):
            try:
                contract = METHODS['projects.shared.' + suffix]
                args = contract.params.model_validate(params, strict=True).model_dump(mode='json')
                request_owner_key(server, write=suffix in {'register', 'update', 'delete'})
                service = SharedProjects(server)
                if suffix in {'update', 'delete'}:
                    result = service.mutate(**args, delete=suffix == 'delete')
                else:
                    result = getattr(service, suffix)(**args)
                check_result(contract, result)
                return server._ok(rid, result)
            except ValidationError as exc:
                return server._err(rid, 4000, str(exc))
            except (ValueError, OSError, hosted_rooms.HostedRoomError, ConversationBindingError) as exc:
                return server._err(rid, 5063, str(exc))
        return run
    for suffix in ('list', 'register', 'resolve', 'update', 'delete'):
        server.register_method('projects.shared.' + suffix, handler(suffix))
        server._LONG_HANDLERS |= frozenset(('projects.shared.' + suffix,))

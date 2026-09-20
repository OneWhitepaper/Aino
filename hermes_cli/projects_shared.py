"""Shared project identity; Profile registrations remain authoritative mutation targets."""
from __future__ import annotations

from gateway.hosted_room_conversation_maintenance import managed_store

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from gateway import hosted_rooms
from gateway.hosted_room_conversation_types import ProjectRef


@dataclass(frozen=True)
class SharedProject:
    id: str
    install_id: str
    environment_id: str
    canonical_path: str
    name: str
    sources: tuple[ProjectRef, ...]


def _initialize(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS shared_projects (
        id TEXT PRIMARY KEY, install_id TEXT NOT NULL, environment_id TEXT NOT NULL,
        canonical_path TEXT NOT NULL, name TEXT NOT NULL,
        UNIQUE(install_id, environment_id, canonical_path))''')
    conn.execute('''CREATE TABLE IF NOT EXISTS shared_project_sources (
        shared_project_id TEXT NOT NULL REFERENCES shared_projects(id),
        install_id TEXT NOT NULL, environment_id TEXT NOT NULL, registration_profile TEXT NOT NULL,
        source_project_id TEXT NOT NULL,
        PRIMARY KEY(install_id, environment_id, registration_profile, source_project_id))''')


@managed_store
class SharedProjectStore:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            _initialize(conn)

    def register(self, *, install_id: str, environment_id: str, canonical_path: str,
                 registration_profile: str, source_project_id: str, name: str) -> SharedProject:
        # The caller owns environment-specific canonicalization. Never parse remote paths here.
        fields = (install_id, environment_id, canonical_path, registration_profile, source_project_id, name)
        if any(not isinstance(value, str) or not value.strip() or '\0' in value for value in fields):
            raise ValueError('project identity fields must be non-empty strings without NUL')
        identity = (install_id, environment_id, canonical_path)
        shared_id = 'shared:' + hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()
        source = (install_id, environment_id, registration_profile, source_project_id)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            old = conn.execute('''SELECT shared_project_id FROM shared_project_sources
                WHERE install_id=? AND environment_id=? AND registration_profile=? AND source_project_id=?''', source).fetchone()
            if old is not None and old[0] != shared_id:
                raise ValueError('source project directory changed; its shared identity cannot be rebound')
            conn.execute('INSERT OR IGNORE INTO shared_projects VALUES (?, ?, ?, ?, ?)', (shared_id, *identity, name))
            conn.execute('INSERT OR IGNORE INTO shared_project_sources VALUES (?, ?, ?, ?, ?)', (shared_id, *source))
        return self.resolve(shared_id)

    def resolve(self, shared_project_id: str) -> SharedProject:
        with hosted_rooms._transaction(self.db_path) as conn:
            row = conn.execute('SELECT * FROM shared_projects WHERE id=?', (shared_project_id,)).fetchone()
            if row is None:
                raise ValueError('shared project does not exist')
            sources = tuple(ProjectRef(row['install_id'], source['registration_profile'], source['source_project_id'],
                                       row['canonical_path'], row['environment_id']) for source in conn.execute(
                'SELECT * FROM shared_project_sources WHERE shared_project_id=? ORDER BY registration_profile, source_project_id',
                (shared_project_id,)))
            return SharedProject(row['id'], row['install_id'], row['environment_id'], row['canonical_path'], row['name'], sources)

    def list_sources(self, shared_project_id: str) -> tuple[ProjectRef, ...]:
        return self.resolve(shared_project_id).sources

    def list(self) -> tuple[SharedProject, ...]:
        with hosted_rooms._transaction(self.db_path) as conn:
            ids = [row[0] for row in conn.execute('SELECT id FROM shared_projects ORDER BY id')]
        return tuple(self.resolve(shared_id) for shared_id in ids)

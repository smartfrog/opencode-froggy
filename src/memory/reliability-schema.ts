export const MEMORY_SCHEMA_VERSION = 4

export const BOUNDED_HISTORY_MIGRATION = [
  `DELETE FROM memory_revisions AS revision WHERE operation = 'remove' AND version < (
    SELECT max(version) FROM memory_revisions
    WHERE entity = revision.entity AND entity_id = revision.entity_id
  )`,
  `DELETE FROM memory_revisions AS revision WHERE version NOT IN (
    SELECT version FROM memory_revisions
    WHERE entity = revision.entity AND entity_id = revision.entity_id ORDER BY version DESC LIMIT 2
  )`,
  "UPDATE memory_revisions SET snapshot = '{}' WHERE operation = 'remove'",
  `PRAGMA user_version=${MEMORY_SCHEMA_VERSION}`,
]

export const RELIABILITY_SCHEMA = `
  CREATE TABLE memory_revisions (
    entity TEXT NOT NULL CHECK(entity IN ('task', 'knowledge')),
    entity_id TEXT NOT NULL, version INTEGER NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('save', 'remove')),
    snapshot TEXT NOT NULL, recorded_at INTEGER NOT NULL,
    UNIQUE(entity, entity_id, version, operation)
  );
  INSERT INTO memory_revisions (entity, entity_id, version, operation, snapshot, recorded_at)
    SELECT 'task', id, version, 'save', json_object(
      'id', id, 'title', title, 'status', status, 'description', description,
      'version', version, 'created_at', created_at, 'updated_at', updated_at
    ), updated_at FROM tasks;
  INSERT INTO memory_revisions (entity, entity_id, version, operation, snapshot, recorded_at)
    SELECT 'knowledge', id, version, 'save', json_object(
      'id', id, 'topic', topic, 'title', title, 'content', content,
      'version', version, 'updated_at', updated_at
    ), updated_at FROM knowledge;
  CREATE VIRTUAL TABLE knowledge_search USING fts5(
    id, title, topic, content,
    content='knowledge', content_rowid='version',
    tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER knowledge_search_insert AFTER INSERT ON knowledge BEGIN
    INSERT INTO knowledge_search(rowid, id, title, topic, content)
    VALUES (new.version, new.id, new.title, new.topic, new.content);
  END;
  CREATE TRIGGER knowledge_search_delete AFTER DELETE ON knowledge BEGIN
    INSERT INTO knowledge_search(knowledge_search, rowid, id, title, topic, content)
    VALUES ('delete', old.version, old.id, old.title, old.topic, old.content);
  END;
  CREATE TRIGGER knowledge_search_update AFTER UPDATE ON knowledge BEGIN
    INSERT INTO knowledge_search(knowledge_search, rowid, id, title, topic, content)
    VALUES ('delete', old.version, old.id, old.title, old.topic, old.content);
    INSERT INTO knowledge_search(rowid, id, title, topic, content)
    VALUES (new.version, new.id, new.title, new.topic, new.content);
  END;
  INSERT INTO knowledge_search(knowledge_search) VALUES ('rebuild');
  PRAGMA user_version=${MEMORY_SCHEMA_VERSION};
`

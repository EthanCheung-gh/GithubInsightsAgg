PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner           TEXT NOT NULL,
  name            TEXT NOT NULL,
  full_name       TEXT NOT NULL UNIQUE,
  description     TEXT,
  html_url        TEXT,
  default_branch  TEXT,
  language        TEXT,
  topics          TEXT,                -- JSON 字符串数组
  is_private      INTEGER NOT NULL DEFAULT 0,
  is_archived     INTEGER NOT NULL DEFAULT 0,
  enabled         INTEGER NOT NULL DEFAULT 1,
  stars           INTEGER NOT NULL DEFAULT 0,
  forks           INTEGER NOT NULL DEFAULT 0,
  watchers        INTEGER NOT NULL DEFAULT 0,
  open_issues     INTEGER NOT NULL DEFAULT 0,
  pushed_at       TEXT,
  created_at      TEXT NOT NULL,
  last_synced_at  TEXT,
  last_sync_error TEXT
);

CREATE TABLE IF NOT EXISTS repo_stat_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id     INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,           -- YYYY-MM-DD (UTC)
  stars       INTEGER NOT NULL DEFAULT 0,
  forks       INTEGER NOT NULL DEFAULT 0,
  watchers    INTEGER NOT NULL DEFAULT 0,
  open_issues INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, date)
);

CREATE TABLE IF NOT EXISTS traffic_daily (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id         INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,
  views           INTEGER NOT NULL DEFAULT 0,
  unique_visitors INTEGER NOT NULL DEFAULT 0,
  clones          INTEGER NOT NULL DEFAULT 0,
  unique_cloners  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, date)
);

CREATE TABLE IF NOT EXISTS traffic_referrers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id     INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,           -- YYYY-MM-DD
  referrer    TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  uniques     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, captured_at, referrer)
);

CREATE TABLE IF NOT EXISTS traffic_paths (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id     INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  path        TEXT NOT NULL,
  title       TEXT,
  count       INTEGER NOT NULL DEFAULT 0,
  uniques     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, captured_at, path)
);

CREATE TABLE IF NOT EXISTS contributors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  login         TEXT NOT NULL,
  avatar_url    TEXT,
  contributions INTEGER NOT NULL DEFAULT 0,
  type          TEXT NOT NULL DEFAULT 'User',
  captured_at   TEXT NOT NULL,
  UNIQUE (repo_id, login)
);

CREATE TABLE IF NOT EXISTS commit_days (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  date    TEXT NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, date)
);

CREATE TABLE IF NOT EXISTS participation_weeks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id    INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  commits    INTEGER NOT NULL DEFAULT 0,
  additions  INTEGER NOT NULL DEFAULT 0,
  deletions  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, week_start)
);

CREATE TABLE IF NOT EXISTS issue_pr_daily (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  issues_opened INTEGER NOT NULL DEFAULT 0,
  issues_closed INTEGER NOT NULL DEFAULT 0,
  pr_opened     INTEGER NOT NULL DEFAULT 0,
  pr_merged     INTEGER NOT NULL DEFAULT 0,
  pr_closed     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, date)
);

CREATE TABLE IF NOT EXISTS releases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  tag_name      TEXT NOT NULL,
  name          TEXT,
  published_at  TEXT,
  is_prerelease INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, tag_name)
);

CREATE TABLE IF NOT EXISTS repo_languages (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id  INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  bytes    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, language)
);

CREATE TABLE IF NOT EXISTS community_profiles (
  repo_id                  INTEGER PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
  health_percentage        INTEGER NOT NULL DEFAULT 0,
  has_readme               INTEGER NOT NULL DEFAULT 0,
  has_license              INTEGER NOT NULL DEFAULT 0,
  has_contributing         INTEGER NOT NULL DEFAULT 0,
  has_code_of_conduct      INTEGER NOT NULL DEFAULT 0,
  has_issue_template       INTEGER NOT NULL DEFAULT 0,
  has_pull_request_template INTEGER NOT NULL DEFAULT 0,
  has_description          INTEGER NOT NULL DEFAULT 0,
  captured_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id         INTEGER,
  scope           TEXT NOT NULL,       -- 'repo' | 'all'
  status          TEXT NOT NULL,       -- 'running' | 'success' | 'partial' | 'error'
  trigger         TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'cli' | 'api'
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  duration_ms     INTEGER,
  records_written INTEGER NOT NULL DEFAULT 0,
  mode            TEXT NOT NULL DEFAULT 'live',   -- 'live' | 'demo'
  error           TEXT
);

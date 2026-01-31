//! ============================================================================
//! Operator Database - Embedded State Storage (redb)
//! ============================================================================
//! Persistent local storage for task cache, session state, verification logs,
//! and operator config. Single-file redb database at ~/.agenc/operator.redb.
//! ============================================================================

pub mod types;

use anyhow::{anyhow, Result};
use redb::{Database, ReadableTable, TableDefinition};
use std::path::{Path, PathBuf};
use tracing::{debug, info, warn};

pub use types::{
    DbTaskStatus, OperatorConfig, SessionState, TaskRecord, TranscriptEntry, VerificationLog,
};

// ============================================================================
// Table Definitions
// ============================================================================

const TASKS: TableDefinition<&str, &[u8]> = TableDefinition::new("tasks");
const SESSIONS: TableDefinition<&str, &[u8]> = TableDefinition::new("sessions");
const PROOFS: TableDefinition<&str, &[u8]> = TableDefinition::new("proofs");
const CONFIG: TableDefinition<&str, &[u8]> = TableDefinition::new("config");

// ============================================================================
// OperatorDb
// ============================================================================

pub struct OperatorDb {
    db: Database,
    path: PathBuf,
}

impl OperatorDb {
    /// Open or create the database at the given path.
    /// Default path: ~/.agenc/operator.redb
    /// Override via AGENC_DB_PATH env var.
    pub fn open(path: Option<&str>) -> Result<Self> {
        let db_path = match path {
            Some(p) => PathBuf::from(p),
            None => {
                let env_path = std::env::var("AGENC_DB_PATH").ok();
                match env_path {
                    Some(p) => PathBuf::from(p),
                    None => {
                        let home = dirs::home_dir()
                            .ok_or_else(|| anyhow!("Cannot determine home directory"))?;
                        home.join(".agenc").join("operator.redb")
                    }
                }
            }
        };

        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| anyhow!("Failed to create database directory: {}", e))?;
        }

        info!("Opening operator database at: {}", db_path.display());
        let db = Database::create(&db_path)
            .map_err(|e| anyhow!("Failed to open database: {}", e))?;

        // Initialize tables by opening a write transaction
        let write_txn = db
            .begin_write()
            .map_err(|e| anyhow!("Failed to begin write txn: {}", e))?;
        {
            let _ = write_txn
                .open_table(TASKS)
                .map_err(|e| anyhow!("Failed to init tasks table: {}", e))?;
            let _ = write_txn
                .open_table(SESSIONS)
                .map_err(|e| anyhow!("Failed to init sessions table: {}", e))?;
            let _ = write_txn
                .open_table(PROOFS)
                .map_err(|e| anyhow!("Failed to init proofs table: {}", e))?;
            let _ = write_txn
                .open_table(CONFIG)
                .map_err(|e| anyhow!("Failed to init config table: {}", e))?;
        }
        write_txn
            .commit()
            .map_err(|e| anyhow!("Failed to commit table init: {}", e))?;

        info!("Operator database initialized successfully");
        Ok(Self { db, path: db_path })
    }

    /// Get the database file path
    pub fn path(&self) -> &Path {
        &self.path
    }

    // ========================================================================
    // Task Operations
    // ========================================================================

    /// Store or update a task record
    pub fn store_task(&self, task: &TaskRecord) -> Result<()> {
        let key = format!("tasks:{}", task.task_id);
        let value = bincode::serialize(task)
            .map_err(|e| anyhow!("Failed to serialize task: {}", e))?;

        let write_txn = self
            .db
            .begin_write()
            .map_err(|e| anyhow!("Failed to begin write: {}", e))?;
        {
            let mut table = write_txn
                .open_table(TASKS)
                .map_err(|e| anyhow!("Failed to open tasks table: {}", e))?;
            table
                .insert(key.as_str(), value.as_slice())
                .map_err(|e| anyhow!("Failed to insert task: {}", e))?;
        }
        write_txn
            .commit()
            .map_err(|e| anyhow!("Failed to commit task: {}", e))?;

        debug!("Stored task: {}", task.task_id);
        Ok(())
    }

    /// Get a task by ID
    pub fn get_task(&self, task_id: &str) -> Result<Option<TaskRecord>> {
        let key = format!("tasks:{}", task_id);

        let read_txn = self
            .db
            .begin_read()
            .map_err(|e| anyhow!("Failed to begin read: {}", e))?;
        let table = read_txn
            .open_table(TASKS)
            .map_err(|e| anyhow!("Failed to open tasks table: {}", e))?;

        match table
            .get(key.as_str())
            .map_err(|e| anyhow!("Failed to get task: {}", e))?
        {
            Some(value) => {
                let task: TaskRecord = bincode::deserialize(value.value())
                    .map_err(|e| anyhow!("Failed to deserialize task: {}", e))?;
                Ok(Some(task))
            }
            None => Ok(None),
        }
    }

    /// List all tasks, optionally filtered by status
    pub fn list_tasks(&self, status_filter: Option<&DbTaskStatus>) -> Result<Vec<TaskRecord>> {
        let read_txn = self
            .db
            .begin_read()
            .map_err(|e| anyhow!("Failed to begin read: {}", e))?;
        let table = read_txn
            .open_table(TASKS)
            .map_err(|e| anyhow!("Failed to open tasks table: {}", e))?;

        let mut results = Vec::new();
        for entry in table
            .iter()
            .map_err(|e| anyhow!("Failed to iterate tasks: {}", e))?
        {
            let (_key, value) =
                entry.map_err(|e| anyhow!("Failed to read entry: {}", e))?;
            let task: TaskRecord = bincode::deserialize(value.value())
                .map_err(|e| anyhow!("Failed to deserialize task: {}", e))?;
            if let Some(filter) = status_filter {
                if task.status == *filter {
                    results.push(task);
                }
            } else {
                results.push(task);
            }
        }
        Ok(results)
    }

    /// Update a task's status
    pub fn update_task_status(&self, task_id: &str, status: DbTaskStatus) -> Result<()> {
        let mut task = self
            .get_task(task_id)?
            .ok_or_else(|| anyhow!("Task not found: {}", task_id))?;
        task.status = status;
        if matches!(task.status, DbTaskStatus::Completed) {
            task.completed_at = Some(chrono::Utc::now().timestamp());
        }
        self.store_task(&task)
    }

    // ========================================================================
    // Session Operations
    // ========================================================================

    /// Store session state
    pub fn store_session(&self, session: &SessionState) -> Result<()> {
        let key = format!("sessions:{}", session.session_id);
        let value = bincode::serialize(session)
            .map_err(|e| anyhow!("Failed to serialize session: {}", e))?;

        let write_txn = self
            .db
            .begin_write()
            .map_err(|e| anyhow!("Failed to begin write: {}", e))?;
        {
            let mut table = write_txn
                .open_table(SESSIONS)
                .map_err(|e| anyhow!("Failed to open sessions table: {}", e))?;
            table
                .insert(key.as_str(), value.as_slice())
                .map_err(|e| anyhow!("Failed to insert session: {}", e))?;
        }
        write_txn
            .commit()
            .map_err(|e| anyhow!("Failed to commit session: {}", e))?;
        Ok(())
    }

    /// Get session state
    pub fn get_session(&self, session_id: &str) -> Result<Option<SessionState>> {
        let key = format!("sessions:{}", session_id);

        let read_txn = self
            .db
            .begin_read()
            .map_err(|e| anyhow!("Failed to begin read: {}", e))?;
        let table = read_txn
            .open_table(SESSIONS)
            .map_err(|e| anyhow!("Failed to open sessions table: {}", e))?;

        match table
            .get(key.as_str())
            .map_err(|e| anyhow!("Failed to get session: {}", e))?
        {
            Some(value) => {
                let session: SessionState = bincode::deserialize(value.value())
                    .map_err(|e| anyhow!("Failed to deserialize session: {}", e))?;
                Ok(Some(session))
            }
            None => Ok(None),
        }
    }

    // ========================================================================
    // Proof Operations
    // ========================================================================

    /// Store a verification log
    pub fn store_proof(&self, proof: &VerificationLog) -> Result<()> {
        let key = format!("proofs:{}", proof.task_id);
        let value = bincode::serialize(proof)
            .map_err(|e| anyhow!("Failed to serialize proof: {}", e))?;

        let write_txn = self
            .db
            .begin_write()
            .map_err(|e| anyhow!("Failed to begin write: {}", e))?;
        {
            let mut table = write_txn
                .open_table(PROOFS)
                .map_err(|e| anyhow!("Failed to open proofs table: {}", e))?;
            table
                .insert(key.as_str(), value.as_slice())
                .map_err(|e| anyhow!("Failed to insert proof: {}", e))?;
        }
        write_txn
            .commit()
            .map_err(|e| anyhow!("Failed to commit proof: {}", e))?;
        Ok(())
    }

    /// Get a verification log for a task
    pub fn get_proof(&self, task_id: &str) -> Result<Option<VerificationLog>> {
        let key = format!("proofs:{}", task_id);

        let read_txn = self
            .db
            .begin_read()
            .map_err(|e| anyhow!("Failed to begin read: {}", e))?;
        let table = read_txn
            .open_table(PROOFS)
            .map_err(|e| anyhow!("Failed to open proofs table: {}", e))?;

        match table
            .get(key.as_str())
            .map_err(|e| anyhow!("Failed to get proof: {}", e))?
        {
            Some(value) => {
                let proof: VerificationLog = bincode::deserialize(value.value())
                    .map_err(|e| anyhow!("Failed to deserialize proof: {}", e))?;
                Ok(Some(proof))
            }
            None => Ok(None),
        }
    }

    // ========================================================================
    // Config Operations
    // ========================================================================

    /// Store operator config
    pub fn store_config(&self, config: &OperatorConfig) -> Result<()> {
        let key = "config:operator";
        let value = bincode::serialize(config)
            .map_err(|e| anyhow!("Failed to serialize config: {}", e))?;

        let write_txn = self
            .db
            .begin_write()
            .map_err(|e| anyhow!("Failed to begin write: {}", e))?;
        {
            let mut table = write_txn
                .open_table(CONFIG)
                .map_err(|e| anyhow!("Failed to open config table: {}", e))?;
            table
                .insert(key, value.as_slice())
                .map_err(|e| anyhow!("Failed to insert config: {}", e))?;
        }
        write_txn
            .commit()
            .map_err(|e| anyhow!("Failed to commit config: {}", e))?;
        Ok(())
    }

    /// Get operator config
    pub fn get_config(&self) -> Result<Option<OperatorConfig>> {
        let key = "config:operator";

        let read_txn = self
            .db
            .begin_read()
            .map_err(|e| anyhow!("Failed to begin read: {}", e))?;
        let table = read_txn
            .open_table(CONFIG)
            .map_err(|e| anyhow!("Failed to open config table: {}", e))?;

        match table
            .get(key)
            .map_err(|e| anyhow!("Failed to get config: {}", e))?
        {
            Some(value) => {
                let config: OperatorConfig = bincode::deserialize(value.value())
                    .map_err(|e| anyhow!("Failed to deserialize config: {}", e))?;
                Ok(Some(config))
            }
            None => Ok(None),
        }
    }
}

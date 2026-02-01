// ============================================================================
// agenc-db — CLI database inspection tool for the AgenC Operator
// ============================================================================
// Usage:
//   agenc-db stats                          Show database statistics
//   agenc-db list-tasks [--status STATUS]   List tasks (optionally filtered)
//   agenc-db export --format json           Export full database as JSON
//   agenc-db prune --older-than 30          Prune old completed tasks/sessions
// ============================================================================

use anyhow::Result;
use chrono::{TimeZone, Utc};
use clap::{Parser, Subcommand};
use operator_core::{DbTaskStatus, OperatorDb};

/// AgenC Operator database inspection tool
#[derive(Parser)]
#[command(name = "agenc-db", version, about = "Inspect and manage the AgenC operator database")]
struct Cli {
    /// Path to the database file (default: ~/.agenc/operator.redb)
    #[arg(long, global = true)]
    db_path: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Show database statistics (task counts, sessions, proofs)
    Stats,

    /// List tasks with optional status filter
    ListTasks {
        /// Filter by status: claimed, in-progress, completed, disputed, resolved
        #[arg(long)]
        status: Option<String>,
    },

    /// Export full database contents as JSON
    Export {
        /// Output format (currently only json is supported)
        #[arg(long, default_value = "json")]
        format: String,
    },

    /// Prune old completed tasks and sessions
    Prune {
        /// Delete completed tasks older than this many days
        #[arg(long, default_value = "30")]
        older_than: i64,

        /// Delete sessions older than this many days (default: 90)
        #[arg(long, default_value = "90")]
        session_days: i64,

        /// Show what would be pruned without actually deleting
        #[arg(long)]
        dry_run: bool,
    },
}

fn parse_status(s: &str) -> Result<DbTaskStatus> {
    match s.to_lowercase().as_str() {
        "claimed" => Ok(DbTaskStatus::Claimed),
        "in-progress" | "inprogress" | "in_progress" => Ok(DbTaskStatus::InProgress),
        "completed" => Ok(DbTaskStatus::Completed),
        "disputed" => Ok(DbTaskStatus::Disputed),
        "resolved" => Ok(DbTaskStatus::Resolved),
        _ => anyhow::bail!(
            "Unknown status '{}'. Valid values: claimed, in-progress, completed, disputed, resolved",
            s
        ),
    }
}

fn format_timestamp(ts: i64) -> String {
    Utc.timestamp_opt(ts, 0)
        .single()
        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S UTC").to_string())
        .unwrap_or_else(|| format!("(invalid: {})", ts))
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let db = OperatorDb::open(cli.db_path.as_deref())?;

    match cli.command {
        Commands::Stats => cmd_stats(&db),
        Commands::ListTasks { status } => cmd_list_tasks(&db, status),
        Commands::Export { format } => cmd_export(&db, &format),
        Commands::Prune {
            older_than,
            session_days,
            dry_run,
        } => cmd_prune(&db, older_than, session_days, dry_run),
    }
}

fn cmd_stats(db: &OperatorDb) -> Result<()> {
    let stats = db.stats()?;

    println!("=== AgenC Operator Database Stats ===");
    println!("Database: {}", db.path().display());
    println!();
    println!("Tasks:    {} total", stats.total_tasks);
    for (status, count) in &stats.task_counts {
        println!("  {:12} {}", status, count);
    }
    println!("Sessions: {}", stats.total_sessions);
    println!("Proofs:   {}", stats.total_proofs);

    Ok(())
}

fn cmd_list_tasks(db: &OperatorDb, status_filter: Option<String>) -> Result<()> {
    let filter = status_filter.as_deref().map(parse_status).transpose()?;
    let tasks = db.list_tasks(filter.as_ref())?;

    if tasks.is_empty() {
        println!("No tasks found.");
        return Ok(());
    }

    println!(
        "{:<36}  {:<12}  {:<22}  {}",
        "TASK ID", "STATUS", "CLAIMED AT", "DESCRIPTION"
    );
    println!("{}", "-".repeat(90));

    for task in &tasks {
        let desc = task
            .description
            .as_deref()
            .unwrap_or("-")
            .chars()
            .take(30)
            .collect::<String>();
        println!(
            "{:<36}  {:<12}  {:<22}  {}",
            task.task_id,
            format!("{:?}", task.status),
            format_timestamp(task.claimed_at),
            desc
        );
    }

    println!("\nTotal: {} tasks", tasks.len());
    Ok(())
}

fn cmd_export(db: &OperatorDb, format: &str) -> Result<()> {
    if format != "json" {
        anyhow::bail!("Unsupported format '{}'. Only 'json' is supported.", format);
    }

    let tasks = db.list_tasks(None)?;
    let sessions = db.list_sessions()?;
    let stats = db.stats()?;
    let config = db.get_config()?;

    let export = serde_json::json!({
        "exported_at": Utc::now().to_rfc3339(),
        "stats": stats,
        "config": config,
        "tasks": tasks,
        "sessions": sessions,
    });

    println!("{}", serde_json::to_string_pretty(&export)?);
    Ok(())
}

fn cmd_prune(db: &OperatorDb, older_than: i64, session_days: i64, dry_run: bool) -> Result<()> {
    if dry_run {
        println!("=== DRY RUN — no data will be deleted ===\n");

        // Count what would be pruned
        let cutoff_tasks = Utc::now().timestamp() - (older_than * 86400);
        let cutoff_sessions = Utc::now().timestamp() - (session_days * 86400);

        let completed_tasks = db.list_tasks(Some(&DbTaskStatus::Completed))?;
        let pruneable_tasks: Vec<_> = completed_tasks
            .iter()
            .filter(|t| {
                let ts = t.completed_at.unwrap_or(t.claimed_at);
                ts < cutoff_tasks
            })
            .collect();

        let sessions = db.list_sessions()?;
        let pruneable_sessions: Vec<_> = sessions
            .iter()
            .filter(|s| s.last_active < cutoff_sessions)
            .collect();

        println!(
            "Would prune {} completed tasks older than {} days",
            pruneable_tasks.len(),
            older_than
        );
        for task in &pruneable_tasks {
            println!(
                "  - {} (completed: {})",
                task.task_id,
                task.completed_at
                    .map(|t| format_timestamp(t))
                    .unwrap_or_else(|| "N/A".into())
            );
        }

        println!(
            "\nWould prune {} sessions older than {} days",
            pruneable_sessions.len(),
            session_days
        );
        for session in &pruneable_sessions {
            println!(
                "  - {} (last active: {})",
                session.session_id,
                format_timestamp(session.last_active)
            );
        }
    } else {
        let pruned_tasks = db.prune_completed_tasks(older_than)?;
        let pruned_sessions = db.prune_old_sessions(session_days)?;

        println!("Pruned {} completed tasks (older than {} days)", pruned_tasks, older_than);
        println!(
            "Pruned {} sessions (older than {} days)",
            pruned_sessions, session_days
        );
    }

    Ok(())
}

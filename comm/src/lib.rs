//! Lycus Inter-Agent Communication Module
//!
//! Provides Matrix-based communication between Lycus agents using the ruma client library.
//! This module handles connection, authentication, room management, and message exchange.

pub mod config;
pub mod matrix;
pub mod bridge;
pub mod discovery;

// Re-export key types for convenience
pub use config::CommConfig;
pub use matrix::LycusMatrixClient;
pub use bridge::{CronBridge, CronTrigger};
pub use discovery::{AgentDiscovery, AgentInfo};

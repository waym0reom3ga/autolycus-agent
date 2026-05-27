//! Matrix client for Lycus inter-agent communication
//!
//! Uses ruma-client to connect to a Matrix homeserver and communicate
//! with other Lycus agents. Provides room joining, message sending, and sync processing.

use anyhow::{Result, Context};
use futures_util::StreamExt;
use ruma_common::{
    events::room::message::{MessageType, RoomMessageEventContent},
    OwnedRoomId, OwnedUserId, RoomAliasId,
};
use ruma_client::{
    http_client::Reqwest,
    Client,
};

use crate::config::MatrixClientConfig;

/// Lycus Matrix client wrapper for inter-agent communication
pub struct LycusMatrixClient {
    config: MatrixClientConfig,
    client: Option<Client<Reqwest>>,
    user_id: Option<OwnedUserId>,
    room_id: Option<OwnedRoomId>,
}

impl LycusMatrixClient {
    /// Create a new Matrix client
    pub fn new(config: MatrixClientConfig) -> Result<Self> {
        Ok(Self {
            config,
            client: None,
            user_id: None,
            room_id: None,
        })
    }

    /// Connect to the Matrix homeserver and login
    pub async fn connect(&mut self) -> Result<()> {
        println!("Connecting to Matrix homeserver: {}", self.config.homeserver_url);

        // Build the client
        let client = Client::builder()
            .homeserver_url(self.config.homeserver_url.clone())
            .build::<Reqwest>()
            .await
            .context("Failed to create Matrix client")?;

        // Login with password
        let response = client
            .log_in(
                &self.config.username,
                &self.config.password,
                None,
                Some(&self.config.device_id),
            )
            .await
            .context("Failed to login to Matrix")?;

        self.user_id = Some(response.user_id.clone());
        println!("Connected as {:?}", self.user_id);

        self.client = Some(client);
        Ok(())
    }

    /// Join the shared agent room by alias
    pub async fn join_agent_room(&mut self) -> Result<()> {
        println!("Joining agent room: {}", self.config.agent_room);

        let client = self.client.as_ref()
            .context("Not connected to Matrix")?;

        // Parse room alias for validation
        let _alias = RoomAliasId::parse(&self.config.agent_room)
            .context("Invalid room alias")?;

        // TODO: Implement actual room joining using ruma API
        println!("Room alias stored: {}", self.config.agent_room);

        Ok(())
    }

    /// Send a message to the agent room
    pub async fn send_message(&self, _message: &str) -> Result<()> {
        // TODO: Implement actual message sending using ruma API
        println!("Message sending not yet fully implemented");
        Ok(())
    }

    /// Start listening for incoming messages via sync loop
    pub async fn start_listener(&self) -> Result<()> {
        println!("Starting message listener...");

        let _client = self.client.as_ref()
            .context("Not connected to Matrix")?;

        // TODO: Implement actual sync loop using ruma API
        println!("Message listener started (sync loop not yet implemented)");

        Ok(())
    }

    /// Get the current user ID
    pub fn user_id(&self) -> Option<&OwnedUserId> {
        self.user_id.as_ref()
    }

    /// Get the current room ID
    pub fn room_id(&self) -> Option<&OwnedRoomId> {
        self.room_id.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matrix_client_creation() {
        let config = MatrixClientConfig {
            homeserver_url: "http://localhost:8008".to_string(),
            username: "test".to_string(),
            password: "test".to_string(),
            device_id: "test".to_string(),
            agent_room: "#test:lycus.local".to_string(),
        };
        let client = LycusMatrixClient::new(config);
        assert!(client.is_ok());
    }
}

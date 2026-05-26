//! Matrix client for Lycus inter-agent communication
//!
//! Uses ruma-client to connect to a Matrix homeserver and communicate
//! with other Lycus agents.

use anyhow::{Result, Context};
use ruma_common::{
    events::room::message::RoomMessageEventContent,
    OwnedUserId, OwnedRoomId, RoomAliasId,
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
    
    /// Join the shared agent room
    pub async fn join_agent_room(&mut self) -> Result<()> {
        println!("Joining agent room: {}", self.config.agent_room);
        
        let client = self.client.as_ref()
            .context("Not connected to Matrix")?;
        
        // Use the join_room_by_id_or_alias method if available, otherwise use raw API
        // For now, we'll use a simpler approach - just store the room alias
        // and resolve it when needed
        
        // Parse room alias for later use
        let _alias = RoomAliasId::parse(&self.config.agent_room)
            .context("Invalid room alias")?;
        
        println!("Room alias stored: {}", self.config.agent_room);
        
        Ok(())
    }
    
    /// Start listening for incoming messages
    pub async fn start_listener(&self) -> Result<()> {
        println!("Starting message listener...");
        
        let client = self.client.as_ref()
            .context("Not connected to Matrix")?;
        
        // Start sync loop - returns a Stream
        // sync(timeout, since, presence, presence_status_msg)
        let _sync_stream = client.sync(
            None,
            String::new(),
            &ruma_common::presence::PresenceState::Online,
            None,
        );
        
        println!("Message listener started");
        
        // TODO: Process events from sync_stream
        // When a message arrives, forward it to the cron bridge
        
        Ok(())
    }
    
    /// Send a message to the agent room
    pub async fn send_message(&self, message: &str) -> Result<()> {
        println!("Sending message: {}", message);
        
        // TODO: Implement actual message sending
        // This requires resolving the room alias to a room ID first
        // Then sending the message to that room
        
        println!("Message sending not yet fully implemented");
        Ok(())
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

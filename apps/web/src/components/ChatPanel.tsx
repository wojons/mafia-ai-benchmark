import React, { useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { GameEvent } from '@mafia/shared/types';

interface ChatPanelProps {
  events: GameEvent[];
  currentPlayerId?: string;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ events, currentPlayerId }) => {
  const { currentGame } = useGameStore();
  const [message, setMessage] = useState('');
  
  const sayEvents = events.filter((e) => e.type === 'AGENT_SAYS_BROADCASTED');
  
  const handleSend = () => {
    if (!message.trim()) return;
    // Send message logic
    setMessage('');
  };
  
  return (
    <div className="chat-panel">
      <div className="panel-header">
        <h3>💬 Discussion</h3>
      </div>
      
      <div className="chat-messages">
        {sayEvents.length === 0 ? (
          <div className="empty-chat">
            <p>No statements yet</p>
            <p className="hint">Statements will appear here during the day phase</p>
          </div>
        ) : (
          sayEvents.map((event, index) => {
            const data = event.data as { playerName?: string; statement?: string };
            const isCurrentPlayer = event.actorId === currentPlayerId;
            
            return (
              <div key={index} className={`chat-message ${isCurrentPlayer ? 'own' : ''}`}>
                <div className="message-header">
                  <span className="player-name">{data.playerName || 'Unknown'}</span>
                  <span className="message-time">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="message-body">{data.statement}</div>
              </div>
            );
          })
        )}
      </div>
      
      <div className="chat-input">
        <input
          type="text"
          placeholder="Type a message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          disabled={currentGame?.currentState.phase !== 'DAY_DISCUSSION'}
        />
        <button className="btn btn-primary" onClick={handleSend} disabled={!message.trim()}>
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatPanel;

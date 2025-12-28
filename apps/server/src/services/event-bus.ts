/**
 * Event Bus Service
 * 
 * Central event distribution system for the Mafia game engine.
 */

import { GameEvent, GamePhase } from '@mafia/shared/types';

export type EventHandler = (event: GameEvent) => void;
export type EventFilter = (event: GameEvent) => boolean;

export interface EventSubscription {
  id: string;
  eventType: string | string[];
  handler: EventHandler;
  filter?: EventFilter;
  once: boolean;
}

export interface EventBusStats {
  totalEvents: number;
  totalSubscriptions: number;
  eventsByType: Map<string, number>;
}

export class EventBus {
  private subscriptions: Map<string, EventSubscription[]>;
  private wildcardSubscriptions: EventSubscription[];
  private eventHistory: GameEvent[];
  private maxHistorySize: number;
  private stats: EventBusStats;
  
  constructor(maxHistorySize: number = 1000) {
    this.subscriptions = new Map();
    this.wildcardSubscriptions = [];
    this.eventHistory = [];
    this.maxHistorySize = maxHistorySize;
    this.stats = {
      totalEvents: 0,
      totalSubscriptions: 0,
      eventsByType: new Map(),
    };
  }
  
  /**
   * Subscribe to events
   */
  subscribe(
    eventType: string | string[],
    handler: EventHandler,
    options?: { filter?: EventFilter; once?: boolean }
  ): () => void {
    const subscription: EventSubscription = {
      id: crypto.randomUUID(),
      eventType,
      handler,
      filter: options?.filter,
      once: options?.once || false,
    };
    
    if (Array.isArray(eventType)) {
      eventType.forEach(type => {
        if (!this.subscriptions.has(type)) {
          this.subscriptions.set(type, []);
        }
        this.subscriptions.get(type)!.push(subscription);
      });
    } else {
      if (!this.subscriptions.has(eventType)) {
        this.subscriptions.set(eventType, []);
      }
      this.subscriptions.get(eventType)!.push(subscription);
    }
    
    this.stats.totalSubscriptions++;
    
    // Return unsubscribe function
    return () => this.unsubscribe(subscription.id);
  }
  
  /**
   * Subscribe to all events (wildcard)
   */
  subscribeAll(handler: EventHandler, options?: { filter?: EventFilter }): () => void {
    const subscription: EventSubscription = {
      id: crypto.randomUUID(),
      eventType: '*',
      handler,
      filter: options?.filter,
      once: false,
    };
    
    this.wildcardSubscriptions.push(subscription);
    this.stats.totalSubscriptions++;
    
    return () => this.unsubscribe(subscription.id);
  }
  
  /**
   * Subscribe to events once
   */
  once(eventType: string | string[], handler: EventHandler, options?: { filter?: EventFilter }): () => void {
    return this.subscribe(eventType, handler, { ...options, once: true });
  }
  
  /**
   * Unsubscribe by subscription ID
   */
  unsubscribe(subscriptionId: string): boolean {
    // Check regular subscriptions
    for (const [eventType, subs] of this.subscriptions) {
      const index = subs.findIndex(s => s.id === subscriptionId);
      if (index !== -1) {
        subs.splice(index, 1);
        this.stats.totalSubscriptions--;
        return true;
      }
    }
    
    // Check wildcard subscriptions
    const wildcardIndex = this.wildcardSubscriptions.findIndex(s => s.id === subscriptionId);
    if (wildcardIndex !== -1) {
      this.wildcardSubscriptions.splice(wildcardIndex, 1);
      this.stats.totalSubscriptions--;
      return true;
    }
    
    return false;
  }
  
  /**
   * Publish an event
   */
  publish(event: GameEvent): void {
    // Add to history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
    
    // Update stats
    this.stats.totalEvents++;
    const typeCount = this.stats.eventsByType.get(event.type) || 0;
    this.stats.eventsByType.set(event.type, typeCount + 1);
    
    // Get subscriptions for this event type
    const subs = this.subscriptions.get(event.type) || [];
    
    // Notify regular subscriptions
    const toRemove: EventSubscription[] = [];
    
    subs.forEach(subscription => {
      // Check filter
      if (subscription.filter && !subscription.filter(event)) {
        return;
      }
      
      try {
        subscription.handler(event);
      } catch (error) {
        console.error(`Error in event handler for ${event.type}:`, error);
      }
      
      // Mark for removal if once-only
      if (subscription.once) {
        toRemove.push(subscription);
      }
    });
    
    // Remove once-only subscriptions
    toRemove.forEach(s => this.unsubscribe(s.id));
    
    // Notify wildcard subscriptions
    this.wildcardSubscriptions.forEach(subscription => {
      if (subscription.filter && !subscription.filter(event)) {
        return;
      }
      
      try {
        subscription.handler(event);
      } catch (error) {
        console.error('Error in wildcard event handler:', error);
      }
    });
  }
  
  /**
   * Get event history
   */
  getHistory(filter?: { eventType?: string; gameId?: string; limit?: number }): GameEvent[] {
    let events = [...this.eventHistory];
    
    if (filter?.eventType) {
      events = events.filter(e => e.type === filter.eventType);
    }
    
    if (filter?.gameId) {
      events = events.filter(e => e.gameId === filter.gameId);
    }
    
    if (filter?.limit) {
      events = events.slice(-filter.limit);
    }
    
    return events;
  }
  
  /**
   * Get events for a specific game
   */
  getGameEvents(gameId: string, options?: { 
    eventType?: string; 
    visibility?: 'PUBLIC' | 'PRIVATE' | 'ADMIN';
    limit?: number;
  }): GameEvent[] {
    return this.getHistory({ gameId }).filter(event => {
      if (options?.eventType && event.type !== options.eventType) {
        return false;
      }
      if (options?.visibility && event.visibility !== options.visibility) {
        return false;
      }
      return true;
    }).slice(-options?.limit || 1000);
  }
  
  /**
   * Get statistics
   */
  getStats(): EventBusStats {
    return {
      ...this.stats,
      eventsByType: new Map(this.stats.eventsByType),
    };
  }
  
  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }
  
  /**
   * Clear all subscriptions
   */
  clearAll(): void {
    this.subscriptions.clear();
    this.wildcardSubscriptions = [];
    this.eventHistory = [];
    this.stats = {
      totalEvents: 0,
      totalSubscriptions: 0,
      eventsByType: new Map(),
    };
  }
}

export default EventBus;

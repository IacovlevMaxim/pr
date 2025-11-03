import assert from 'node:assert';
import Coordinate from "./coordinate.js";

/**
 * Represents an entry in the queue for a card.
 */
type QueueEntry = {
    /** The player ID waiting for control; must be a nonempty string of alphanumeric or underscore characters */
    playerId: string;
    /** The coordinate of the card the player is waiting for */
    coord: Coordinate;
    /** Function to resolve the promise when the player can take control */
    resolve: () => void;
    /** Function to reject the promise if the card becomes unavailable */
    reject: (reason?: Error) => void;
};

/**
 * Manages a queue of players waiting to control cards in the Memory Scramble game.
 * When a card becomes available, all waiting players are notified simultaneously
 * and race to take control of the card.
 * 
 * Mutable: the queue contents change as players join and leave the queue
 */
export default class Queue {
    private readonly queue: QueueEntry[] = [];

    // Abstraction function:
    //   AF(queue) = a queue of players waiting for cards, where each entry represents
    //               a player with playerId waiting to control the card at coord,
    //               with resolve/reject functions to notify them when the card becomes available or unavailable
    // Representation invariant:
    //   - all queue entries have valid playerIds (nonempty strings of alphanumeric or underscore characters)
    //   - no duplicate (playerId, coord) pairs in the queue (a player can only wait once for a specific card)
    //   - all resolve and reject functions are defined (not null/undefined)
    // Safety from rep exposure:
    //   - queue is private and readonly (the reference can't be changed)
    //   - getQueue() returns a defensive copy of the queue array
    //   - QueueEntry contains only immutable types (string for playerId and coord) and functions
    //   - Coordinate type is a string (immutable)
    //   - no mutable objects are exposed to clients

    /**
     * Create a new empty queue.
     */
    public constructor() {
        this.checkRep();
    }

    /**
     * Check the representation invariant.
     */
    private checkRep(): void {
        // Check all entries have valid playerIds
        for (const entry of this.queue) {
            assert(/^[a-zA-Z0-9_]+$/.test(entry.playerId), 
                `Invalid playerId in queue: ${entry.playerId}`);
            assert(typeof entry.resolve === 'function', 'resolve must be a function');
            assert(typeof entry.reject === 'function', 'reject must be a function');
        }
        
        // Check no duplicate (playerId, coord) pairs
        const seen = new Set<string>();
        for (const entry of this.queue) {
            const key = `${entry.playerId}:${entry.coord}`;
            assert(!seen.has(key), `Duplicate queue entry for ${entry.playerId} at ${entry.coord}`);
            seen.add(key);
        }
    }

    /**
     * Add a player to the queue for a specific card.
     * The returned promise resolves when the card becomes available.
     * 
     * @param playerId the ID of the player joining the queue;
     *                 must be a nonempty string of alphanumeric or underscore characters
     * @param coord the coordinate of the card the player is waiting for
     * @returns a promise that resolves when the card becomes available,
     *          or rejects if the card is removed from the board
     * @throws Error if playerId is not a nonempty string of alphanumeric or underscore characters
     * @throws Error if the player is already in the queue for this card
     * @post the player is added to the queue for the specified card
     */
    public addToQueue(playerId: string, coord: Coordinate): Promise<void> {
        assert(/^[a-zA-Z0-9_]+$/.test(playerId), 'playerId must be a nonempty string of alphanumeric or underscore characters');
        
        // Check if player is already in queue for this coordinate
        if (this.queue.some(entry => entry.playerId === playerId && entry.coord === coord)) {
            throw new Error("Player already in queue for this card");
        }

        const { promise, resolve, reject } = Promise.withResolvers<void>();
        this.queue.push({ playerId, coord, resolve, reject });
        this.checkRep();
        return promise;
    }

    /**
     * Process all queue entries waiting for a specific card.
     * Resolves all waiting promises simultaneously so players race to take control.
     * 
     * @param coord the coordinate of the card that became available
     * @post all queue entries for this coordinate are removed and their promises resolved
     */
    public processQueue(coord: Coordinate): void {
        // Get all entries waiting for this coordinate
        const entries = this.queue.filter(entry => entry.coord === coord);
        
        // Remove all these entries from the queue
        this.queue.splice(0, this.queue.length, 
            ...this.queue.filter(entry => entry.coord !== coord)
        );
        
        // Resolve all of them - they will race to take control
        for (const entry of entries) {
            // console.log(`resolving ${entry.playerId} promise for ${entry.coord}`)
            entry.resolve();
        }
        this.checkRep();
    }

    /**
     * Remove a specific player from the queue for a specific card.
     * Rejects the promise with an error indicating the card is no longer available.
     * 
     * @param playerId the ID of the player to remove from the queue;
     *                 must be a nonempty string of alphanumeric or underscore characters
     * @param coord the coordinate of the card
     * @throws Error if playerId is not a nonempty string of alphanumeric or underscore characters
     * @post if the player was in the queue for this card, they are removed and their promise is rejected
     */
    public removeFromQueue(playerId: string, coord: Coordinate): void {
        assert(/^[a-zA-Z0-9_]+$/.test(playerId), 'playerId must be a nonempty string of alphanumeric or underscore characters');
        
        const index = this.queue.findIndex(entry => 
            entry.playerId === playerId && entry.coord === coord
        );
        if (index !== -1) {
            const entry = this.queue.splice(index, 1)[0];
            entry?.reject(new Error("Card no longer available"));
        }
        this.checkRep();
    }

    /**
     * Check if a player is in the queue for a specific card.
     * 
     * @param playerId the ID of the player to check;
     *                 must be a nonempty string of alphanumeric or underscore characters
     * @param coord the coordinate of the card
     * @returns true if the player is in the queue for this card, false otherwise
     * @throws Error if playerId is not a nonempty string of alphanumeric or underscore characters
     */
    public isInQueue(playerId: string, coord: Coordinate): boolean {
        assert(/^[a-zA-Z0-9_]+$/.test(playerId), 'playerId must be a nonempty string of alphanumeric or underscore characters');
        
        return this.queue.some(entry => entry.playerId === playerId && entry.coord === coord);
    }

    /**
     * Get a copy of all queue entries.
     * 
     * @returns a copy of the array array containing all current queue entries
     */
    public getQueue(): QueueEntry[] {
        return [...this.queue];
    }
}
import assert from 'node:assert';
import Coordinate from "./coordinate.js";

/**
 * Represents a player in the Memory Scramble game.
 * Each player can control up to 2 cards at a time and maintains a history of previously controlled cards.
 * 
 * Mutable: the controlled cards and previous cards lists can change
 */
export default class Player {
    private readonly _controlledCards: Coordinate[] = [];
    private readonly _prevCards: Coordinate[] = [];

    // Abstraction function:
    //   AF(id, _controlledCards, _prevCards) = a player with unique identifier id,
    //                                          currently controlling cards at coordinates in _controlledCards,
    //                                          and having previously controlled cards at coordinates in _prevCards
    // Representation invariant:
    //   - id is a nonempty string of alphanumeric or underscore characters
    //   - _controlledCards.length <= 2 (player can control at most 2 cards)
    //   - _controlledCards contains no duplicate coordinates
    //   - _prevCards contains no duplicate coordinates
    // Safety from rep exposure:
    //   - id is readonly and a string (immutable)
    //   - _controlledCards is private, readonly and methods return defensive copies
    //   - _prevCards is private, readonly and getter returns a defensive copy
    //   - Coordinate type is a string (immutable)
    //   - all methods return immutable types, void, or defensive copies

    /**
     * Create a new player with the given ID.
     * 
     * @param id the unique identifier for this player;
     *           must be a nonempty string of alphanumeric or underscore characters
     * @throws Error if id is not a nonempty string of alphanumeric or underscore characters
     */
    public constructor(public readonly id: string) {
        assert(/^[a-zA-Z0-9_]+$/.test(id), 'Player id must be a nonempty string of alphanumeric or underscore characters');
        this.checkRep();
    }

    /**
     * Check the representation invariant.
     */
    private checkRep(): void {
        // Check id is valid
        assert(/^[a-zA-Z0-9_]+$/.test(this.id), 'Player id must be a nonempty string of alphanumeric or underscore characters');
        
        // Check controlled cards limit
        assert(this._controlledCards.length <= 2, `Player ${this.id} cannot control more than 2 cards`);
        
        // Check no duplicate controlled cards
        const controlledSet = new Set(this._controlledCards);
        assert(controlledSet.size === this._controlledCards.length, `Player ${this.id} has duplicate controlled cards`);
        
        // Check no duplicate previous cards
        const prevSet = new Set(this._prevCards);
        assert(prevSet.size === this._prevCards.length, `Player ${this.id} has duplicate previous cards`);
    }

    /**
     * Give this player control of a card at the specified coordinate.
     * 
     * @param coord the coordinate of the card to control
     * @throws Error if the player already controls this card
     * @throws Error if the player already controls 2 cards (maximum allowed)
     * @pre Player controls less than two cards
     * @post Player controls the given coordinate
     */
    public takeControl(coord: Coordinate): void {
        if(this._controlledCards.includes(coord)) throw new Error(`Player "${this.id}" already controls this card`);

        if(this._controlledCards.length >= 2) throw new Error(`Player ${this.id} cannot control any more cards!`);

        this._controlledCards.push(coord);
        this.checkRep();
    }

    /**
     * Remove control of a card at the specified coordinate.
     * 
     * @param coord the coordinate of the card to release control of
     * @throws Error if the player is not controlling the specified card
     * @pre Player controls the given card
     * @post Player does not control the given card anymore
     */
    public giveUpControl(coord: Coordinate): void {
        if(!this._controlledCards.includes(coord)) throw new Error(`Player ${this.id} is not controlling ${coord}`);

        const coordIndex = this._controlledCards.indexOf(coord);

        this._controlledCards.splice(coordIndex, 1);
        this.checkRep();
    }

    /**
     * Get a copy of the list of previously controlled cards.
     * 
     * @returns a copy of the array of coordinates representing cards previously controlled by this player
     */
    public get prevCards(): Coordinate[] {
        return [...this._prevCards];
    }

    /**
     * Add one or more coordinates to the previous cards list.
     * 
     * @param coord one or more coordinates to add to the previous cards list
     * @post previous cards do not contain duplicates
     */
    public pushToPrev(...coord: Coordinate[]): void {
        this._prevCards.push(...coord.filter(c => !this._prevCards.includes(c)));
        this.checkRep();
    }

    /**
     * Remove a coordinate from the previous cards list.
     * 
     * @param coord the coordinate to remove from the previous cards list
     * @pre coordinate was previously controlled by the player
     * @post if coord was previously controlled, it is removed
     */
    public removeFromPrev(coord: Coordinate): void {
        const coordIndex = this._prevCards.indexOf(coord);

        assert(coordIndex !== -1, `Coordinate ${coord} was not previously controlled by ${this.id}`);

        this._prevCards.splice(coordIndex, 1);
        this.checkRep();
    }

    /**
     * Clear all coordinates from the previous cards list.
     * 
     * @post this._prevCards.length === 0
     */
    public clearPrev(): void {
        this._prevCards.splice(0);
        this.checkRep();
    }

    /**
     * Check if this player controls the card at the specified coordinate.
     * 
     * @param coord the coordinate to check
     * @returns true if this player controls the card at coord, false otherwise
     */
    public hasControl(coord: Coordinate): boolean {
        return this._controlledCards.includes(coord);
    }

    /**
     * Get a copy of the list of currently controlled cards.
     * 
     * @returns a copy of the array array of coordinates representing cards currently controlled by this player
     */
    public getCards(): Coordinate[] {
        return [...this._controlledCards];
    }

    /**
     * Get a string representation of this player.
     * 
     * @returns a string describing the player and their controlled cards
     */
    public toString(): string {
        return `Player ${this.id} with cards ${this.getCards()}`;
    }
}
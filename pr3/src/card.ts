import assert from 'node:assert';
import fs from 'node:fs';
import Coordinate from './coordinate.js';

/**
 * Represents a card in the Memory Scramble game.
 * Each card has a symbol and can be face up or face down.
 * 
 * Mutable: the face-up/face-down state can change
 */
export default class Card {
    public isFaceUp = false;

    // Abstraction function:
    //   AF(symbolId, isFaceUp) = a card with symbol identified by symbolId,
    //                            which is face up if isFaceUp is true, 
    //                            or face down if isFaceUp is false
    // Representation invariant:
    //   - symbolId is a non-negative integer
    // Safety from rep exposure:
    //   - symbolId is readonly and a primitive type (immutable)
    //   - isFaceUp is public but is a primitive boolean (immutable)
    //   - all methods return immutable types or void
    //   - generateCoordinate() is static and returns an immutable string

    /**
     * Create a new card with the given symbol.
     * The card starts face down.
     * 
     * @param symbolId the symbol identifier for this card; must be a non-negative integer
     * @throws AssertionError if symbolId is not an integer or is a negative number
     */
    public constructor(public readonly symbolId: number) {
        assert(Number.isInteger(symbolId));
        assert(symbolId >= 0);
        this.checkRep();
    }

    /**
     * Check the representation invariant.
     */
    private checkRep(): void {
        assert(Number.isInteger(this.symbolId), 'symbolId must be an integer');
        assert(this.symbolId >= 0, 'symbolId must be non-negative');
    }

    /**
     * Turn this card face up.
     * 
     * @post this.isFaceUp === true
     */
    public flipUp(): void {
        this.isFaceUp = true;
        this.checkRep();
    }

    /**
     * Turn this card face down.
     * 
     * @post this.isFaceUp === false
     */
    public flipDown(): void {
        this.isFaceUp = false;
        this.checkRep();
    }

    /**
     * Get the string representation of this card's symbol.
     * 
     * @returns the symbol identifier as a string
     */
    public toString(): string {
        return String(this.symbolId);
    }

    /**
     * Generate a coordinate string from row and column indices.
     * 
     * @param row the row index; must be a non-negative integer
     * @param col the column index; must be a non-negative integer
     * @returns a coordinate in the format "rowxcol"
     * @throws AssertionError if either of the parameters is not an integer or is a negative number
     */
    public static generateCoordinate(row: number, col: number): Coordinate {
        assert(Number.isInteger(row));
        assert(row >= 0);

        assert(Number.isInteger(col));
        assert(col >= 0);

        return `${row}x${col}`;
    }
}
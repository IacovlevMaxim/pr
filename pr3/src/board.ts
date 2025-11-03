/* Copyright (c) 2021-25 MIT 6.102/6.031 course staff, all rights reserved.
 * Redistribution of original or derived work requires permission of course staff.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import Card from './card.js';
import Queue from './queue.js';
import Coordinate from './coordinate.js';
import Player from './player.js';
import stripIndent from 'strip-indent';

/**
 * TODO specification
 * Mutable and concurrency safe.
 */
export class Board {

    // TODO fields
    private readonly _cards: Map<Coordinate, Card>;
    private readonly _queue: Queue = new Queue();
    private readonly _players: Player[] = [];
    private readonly _listeners: ((b: string) => void)[] = [];

    // Abstraction function:
    //   AF(height, width, board) = a memory game board where:
    //   - height × width represents the dimensions of the board
    //   - board[i][j] represents the card at row i, column j where:
    //     * card is Card object, which handles its own symbol and flip state

    // Representation invariant:
    //  * - rows > 0
    //  * - cols > 0
    //  * - all cards in the map have valid coordinates (within board bounds)
    //  * - all card symbols are non-empty strings
    //  * - if a card has a controller, then it must be face up
    //  * - no player controls more than 2 cards
    //  * - all sprites are non-empty strings

    // Safety from rep exposure:
    //  * - all private arrays are readonly to prevent overwriting
    //  * - in case a method performs array modifications, the original reference to the array is never modified
    //  * - methods that might cause concurrency ensure that the latest data from internal data is accessed and changed


    // TODO constructor
    public constructor(cards: Map<Coordinate, Card>, public readonly rows: number, public readonly cols: number,  private readonly _sprites: string[]) {
        this._cards = new Map(cards);
        this.checkRep();
    }

    /**
     * Check the representation invariant.
     */
    private checkRep(): void {
        // Check board dimensions
        assert(this.rows > 0, 'Board height must be greater than 0');
        assert(this.cols > 0, 'Board width must be greater than 0');

        // Check all coordinates are within bounds
        for (const [coord, card] of this._cards.entries()) {
            const [rowStr, colStr] = coord.split('x');
            const row = parseInt(rowStr ?? '');
            const col = parseInt(colStr ?? '');
            
            assert(!isNaN(row) && !isNaN(col), `Invalid coordinate format: ${coord}`);
            assert(row >= 0 && row < this.rows, `Row ${row} out of bounds (0-${this.rows - 1})`);
            assert(col >= 0 && col < this.cols, `Column ${col} out of bounds (0-${this.cols - 1})`);
            
            // Check card symbol is non-empty
            assert(card.symbolId !== undefined && card.symbolId !== null, `Card at ${coord} has invalid symbol`);
        }

        // Check that if a card has a controller, it must be face up
        for (const player of this._players) {
            for (const coord of player.getCards()) {
                const card = this._cards.get(coord);
                assert(card !== undefined, `Player ${player.id} controls non-existent card at ${coord}`);
                assert(card.isFaceUp, `Player ${player.id} controls face-down card at ${coord}`);
            }
            
            // Check no player controls more than 2 cards
            assert(player.getCards().length <= 2, `Player ${player.id} controls more than 2 cards`);
        }

        // Check all sprites are non-empty strings
        for (let i = 0; i < this._sprites.length; i++) {
            const sprite = this._sprites[i];
            assert(sprite !== undefined && sprite.length > 0, `Sprite at index ${i} is empty`);
        }
    }

    // TODO other methods

    /**
     * Make a new board by parsing a file.
     * 
     * PS4 instructions: the specification of this method may not be changed.
     * 
     * @param filename path to game board file
     * @returns a new board with the size and cards from the file
     * @throws Error if the file cannot be read or is not a valid game board
     */
    public static async parseFromFile(filename: string): Promise<Board> {
        const boardFile = await fs.promises.readFile(filename);

        const lines = boardFile
            .toString()
            .replaceAll('\r\n', '\n')
            .split('\n');

        assert(lines.length > 1);
        assert(lines[0] !== undefined);
        assert(lines[0].includes('x'));

        const [ strRows, strColumns ] = lines.shift()!.split('x');
        const rows = Number(strRows);
        const columns = Number(strColumns);

        assert(rows > 0);
        assert(columns > 0);
        assert(lines.length === (rows * columns) + 1); // added 1 at the end because of the empty line at eof

        const cards: Map<Coordinate, Card> = new Map();

        let currRow = 0;
        let currColumn = 0;
        const sprites: string[] = [];
        while(lines.length > 0 && currRow < rows && currColumn <= columns) {
            const line = lines.shift()!;

            if(!sprites.includes(line)) {
                sprites.push(line);
            }

            const coord = Card.generateCoordinate(currRow, currColumn);
            cards.set(coord, new Card(sprites.indexOf(line)));
            currColumn++;

            if(currColumn === columns) {
                currRow++;
                currColumn = 0;
            }
        }


        return new Board(cards, rows, columns, sprites);
    }

    /**
     * Looks at the current state of the board.
     *
     * @param playerId ID of player looking at the board; 
     *                 must be a nonempty string of alphanumeric or underscore characters
     * @returns the state of the board from the perspective of playerId, in the format 
     *          described in the ps4 handout
     */
    public async look(playerId: string): Promise<string> {
        const lines = [];
        lines.push(`${this.rows}x${this.cols}`);

        this.checkRep();

        // In case it is a new player, add them to the player list
        if(!this._players.find(p => p.id === playerId)) {
            this._players.push(new Player(playerId));
        }

        for(let i = 0;i < this.rows;i++) {
            for(let j = 0;j < this.cols;j++) {
                const coord = Card.generateCoordinate(i, j);
                const card = this._cards.get(coord);

                if(!card) {
                    lines.push("none");
                    continue;
                }

                if(!card.isFaceUp) {
                    lines.push("down");
                    continue;
                }

                const controllingPlayer = this._players.find(p => p.hasControl(coord));
                const sprite = this._sprites[card.symbolId];
                if(controllingPlayer?.id === playerId) {
                    lines.push(`my ${sprite}`);
                } else {
                    lines.push(`up ${sprite}`);
                }
            }
        }

        return lines.join('\n');
    }

    private _pushToPrev(playerId: string, coord: Coordinate): void {
        for(const player of this._players) {
            if(player.id === playerId) {
                player.pushToPrev(coord);
                continue;
            }

            if(!player.prevCards.includes(coord)) continue;

            player.removeFromPrev(coord);
        }
    }

    /**
     * Tries to flip over a card on the board, following the rules in the ps4 handout.
     * If another player controls the card, then this operation waits until the flip 
     * either becomes possible or fails.
     *
     * @param playerId ID of player making the flip; 
     *                 must be a nonempty string of alphanumeric or underscore characters
     * @param coord valid Coordinate that references a point on the board
     * @param withCleanup (default: true) used internally for managing when to perform cleanup
     * @returns the state of the board after the flip from the perspective of playerId, in the 
     *          format described in the ps4 handout
     * @throws an error (in a rejected promise) if the flip operation fails as described 
     *         in the ps4 handout.
     */
    public async flip(playerId: string, coord: Coordinate, withCleanup = true): Promise<void> {
        // In case it is a new player, add them to the player list
        if(!this._players.find(p => p.id === playerId)) {
            this._players.push(new Player(playerId));
        }
        const currPlayer = this._players.find(p => p.id === playerId)!;

        if(withCleanup) {
            this._cleanUp(playerId);
        }

        const controllingPlayer = this._players.find(p => p.hasControl(coord));

        const playerCards = currPlayer.getCards();
        const boardCards = playerCards.map(c => this._cards.get(c));

        // Make sure all player card exist in board state
        assert(boardCards.filter(p => p).length === playerCards.length);

        if(playerCards.length === 2) {
            const [ firstCard, secondCard ] = boardCards;
            if(firstCard?.symbolId === secondCard?.symbolId) {
                for(const coord of playerCards) {
                    this._cards.delete(coord);

                    currPlayer.giveUpControl(coord);
                    this._queue.removeFromQueue(playerId, coord);
                }

                if(playerCards.splice(0).includes(coord)) {
                    throw new Error("Nothing here!"); 
                }
            }
        }

        const card = this._cards.get(coord);
        if(!card) {
            // In case the player tries to take control over cards that were cleaned up, do nothing
            this._queue.removeFromQueue(playerId, coord);

            for(const card of currPlayer.getCards()) {
                currPlayer.giveUpControl(card);
                // currPlayer.pushToPrev(card);
                this._queue.removeFromQueue(playerId, card);
            }

            throw new Error("Nothing here!");
        }

        // First card (rules 1-)
        if(playerCards.length === 0) {
            // 1-A If there is no card there (the player identified an empty space, perhaps because the card was just removed by another player), the operation fails.
            if(!card) {
                throw new Error("Nothing here!");
            }

            // 1-B If the card is face down, it turns face up (all players can now see it) and the player controls that card.
            if(!card.isFaceUp) {
                // currPlayer is a reference to the object in the array, so we can modify it like this and expect it to be changed in the array
                currPlayer.takeControl(coord);

                card.flipUp();
                this._cards.set(coord, card);
            } else {
                // 1-C If the card is already face up, but not controlled by another player, then it remains face up, and the player controls the card. 
                if(!controllingPlayer) {
                    currPlayer.takeControl(coord);
                } else {
                    // 1-D If the card is face up and controlled by another player, the operation waits. The player will contend with other players to take control of the card at the next opportunity.
                    await this._queue.addToQueue(playerId, coord);
                    // After waiting, try to take control if possible

                    return this.flip(playerId, coord);
                }
            }
        } // Second card (rules 2-) 
        else if(playerCards.length === 1) {
            const firstCard = playerCards[0]!;
            // 2-A If there is no card there, the operation fails. The player also relinquishes control of their first card (but it remains face up for now).
            if(!card) {
                currPlayer.giveUpControl(firstCard);

                this._processQueue();

                throw new Error("Nothing here!");
            }

            // 2-B If the card is face up and controlled by a player (another player or themselves), the operation fails. 
            // To avoid deadlocks, the operation does not wait. The player also relinquishes control of their first card (but it remains face up for now).
            if(card.isFaceUp && controllingPlayer) {
                currPlayer.giveUpControl(firstCard);

                this._processQueue();

                this._pushToPrev(playerId, playerCards[0]!);
                this._pushToPrev(playerId, coord);

                // Add previous card to flip down queue too
                // this._flipDownQueue.push(...playerCards);
                // this._flipDownQueue.push(coord);

                throw new Error("This card is already under control");
                // this._processQueue();
                await this._notifyAll();

                console.log("returning new board state");

                // return this.look(playerId);
            }

            // If the card is face down, or if the card is face up but not controlled by a player, then:

            // 2-C If it is face down, it turns face up.
            if(!card.isFaceUp) card.flipUp();

            // 2-D If the two cards are the same, that’s a successful match! The player keeps control of both cards (and they remain face up on the board for now).
            const firstBoardCard = boardCards[0]!;
            if(firstBoardCard.symbolId === card.symbolId) {
                currPlayer.takeControl(coord);
            } else {
                // 2-E If they are not the same, the player relinquishes control of both cards (again, they remain face up for now).
                this._pushToPrev(playerId, firstCard);
                this._pushToPrev(playerId, coord);
                currPlayer.giveUpControl(firstCard);
            }
        }

        this._processQueue();
        await this._notifyAll();
    }

    private _cleanUp(playerId: string): void {
        const player = this._players.find(p => p.id === playerId);
        assert(player !== undefined, `Player with ID ${playerId} not found during cleanup`);

        for(const coord of player.prevCards) {
            if(this._players.some(p => p.hasControl(coord))) continue;

            const card = this._cards.get(coord);
            if(!card) continue;

            card.flipDown();
        }
    }

    private _processQueue(): void {
        const controlledCards = this._players.flatMap(player => player.getCards());
        for(const entry of this._queue.getQueue()) {
            if(controlledCards.includes(entry.coord)) continue;

            this._queue.processQueue(entry.coord);
        }
    }

    public get cards(): Map<`${number}x${number}`, Card> {
        return new Map(this._cards);
    }

    public async map(playerId: string, f: (card: string) => Promise<string>): Promise<void> {
        const newSprites = await Promise.all(this._sprites.map(f));
        this._sprites.splice(0, this._sprites.length, ...newSprites);
    }

    private async _notifyAll(): Promise<void> {
        for (const fn of this._listeners.splice(0)) {
            fn(""); // any look to trigger
        }
    }

    public async watch(playerId: string): Promise<string> {
        return new Promise<string>(resolve => {
            this._listeners.push(() => resolve(this.look(playerId)));
        });
    }
}

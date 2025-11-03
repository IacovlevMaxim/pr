/* Copyright (c) 2021-25 MIT 6.102/6.031 course staff, all rights reserved.
 * Redistribution of original or derived work requires permission of course staff.
 */

import assert from 'node:assert';
import { Board } from './board.js';

/**
 * Example code for simulating a game.
 * 
 * PS4 instructions: you may use, modify, or remove this file,
 *   completing it is recommended but not required.
 * 
 * @throws Error if an error occurs reading or parsing the board
 */
async function simulationMain(): Promise<void> {
    const filename = 'boards/zoom.txt';
    const board: Board = await Board.parseFromFile(filename);
    const size = 5;
    const players = 4;
    const tries = 100;
    const minDelayMilliseconds = 0.1;
    const maxDelayMilliseconds = 2;

    const simulationStartTime = Date.now();

    // start up one or more players as concurrent asynchronous function calls
    const playerPromises: Array<Promise<void>> = [];
    const playerStats: Array<{ playerId: string, totalMoves: number, successfulMoves: number, failedMoves: number, totalTimeMs: number }> = [];
    
    for (let i = 0; i < players; i++) {
        playerPromises.push(player(i));
    }
    // wait for all the players to finish (unless one throws an exception)
    await Promise.all(playerPromises);

    const simulationEndTime = Date.now();
    const totalSimulationTime = simulationEndTime - simulationStartTime;

    // Print statistics
    console.log('\n=== Simulation Statistics ===');
    console.log(`Total simulation time: ${totalSimulationTime}ms (${(totalSimulationTime / 1000).toFixed(2)}s)`);
    console.log('');
    for (const stats of playerStats) {
        console.log(`${stats.playerId}:`);
        console.log(`  Total moves: ${stats.totalMoves}`);
        console.log(`  Successful: ${stats.successfulMoves} (${((stats.successfulMoves / stats.totalMoves) * 100).toFixed(1)}%)`);
        console.log(`  Failed: ${stats.failedMoves} (${((stats.failedMoves / stats.totalMoves) * 100).toFixed(1)}%)`);
        console.log(`  Time spent: ${stats.totalTimeMs}ms (${(stats.totalTimeMs / 1000).toFixed(2)}s)`);
    }
    console.log('=============================\n');

    /** @param playerNumber player to simulate */
    async function player(playerNumber: number): Promise<void> {
        // TODO set up this player on the board if necessary
        const playerId = `player${playerNumber}`;
        await board.look(playerId);

        const playerStartTime = Date.now();
        let totalMoves = 0;
        let successfulMoves = 0;
        let failedMoves = 0;

        for (let j = 0; j < tries; j++) {
            totalMoves++;
            try {
                await timeout(minDelayMilliseconds + Math.random() * (maxDelayMilliseconds - minDelayMilliseconds));
                // TODO try to flip over a first card at (randomInt(size), randomInt(size))
                //      which might wait until this player can control that card
                const row1 = randomInt(size);
                const col1 = randomInt(size);
                const coord1 = `${row1}x${col1}` as const;
                await board.flip(playerId, coord1);

                await timeout(minDelayMilliseconds + Math.random() * (maxDelayMilliseconds - minDelayMilliseconds));
                // TODO and if that succeeded,
                //      try to flip over a second card at (randomInt(size), randomInt(size))
                const row2 = randomInt(size);
                const col2 = randomInt(size);
                const coord2 = `${row2}x${col2}` as const;
                await board.flip(playerId, coord2);
                
                successfulMoves++;
            } catch (err) {
                // attempt to flip a card failed - this is expected, continue playing
                failedMoves++;
            }
        }
        
        const playerEndTime = Date.now();
        const totalTimeMs = playerEndTime - playerStartTime;
        playerStats.push({ playerId, totalMoves, successfulMoves, failedMoves, totalTimeMs });
    }
}

/**
 * Random positive integer generator
 * 
 * @param max a positive integer which is the upper bound of the generated number
 * @returns a random integer >= 0 and < max
 */
function randomInt(max: number): number {
    return Math.floor(Math.random() * max);
}


/**
 * @param milliseconds duration to wait
 * @returns a promise that fulfills no less than `milliseconds` after timeout() was called
 */
async function timeout(milliseconds: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, milliseconds);
    return promise;
}

void simulationMain();

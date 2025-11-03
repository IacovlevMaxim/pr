/* Copyright (c) 2021-25 MIT 6.102/6.031 course staff, all rights reserved.
 * Redistribution of original or derived work requires permission of course staff.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import { Board } from '../src/board.js';
import Coordinate from '../src/coordinate.js';


/**
 * Tests for the Board abstract data type.
 */
describe('Board', function() {
    
    // Testing strategy
    // 
    // parseFromFile():
    //   - valid board file with correct dimensions
    //   - board with different sizes
    // 
    // Rule 1 - First card:
    //   1-A: flip empty space (no card) -> operation fails
    //   1-B: flip face-down card -> turns face up, player controls it
    //   1-C: flip face-up uncontrolled card -> player takes control
    //   1-D: flip face-up controlled card -> operation waits
    // 
    // Rule 2 - Second card:
    //   2-A: flip empty space -> fails, relinquish first card
    //   2-B: flip controlled card -> fails, relinquish first card
    //   2-C: flip face-down card -> turns face up
    //   2-D: matching cards -> player keeps control of both
    //   2-E: non-matching cards -> player relinquishes control of both
    //
    // Rule 3 - Next first card (cleanup):
    //   3-A: matching pair controlled by player -> cards removed from board
    //   3-B: non-matching cards not controlled -> turned face down
    //
    // Concurrency:
    //   - multiple players playing simultaneously
    //   - queue processing when cards become available

    describe('parseFromFile', function() {
        it('parses a valid 5x5 board file', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            assert.strictEqual(board.rows, 5);
            assert.strictEqual(board.cols, 5);
            
            const result = await board.look('player1');
            const lines = result.split('\n');
            assert.strictEqual(lines[0], '5x5');
            assert.strictEqual(lines.length, 26); // 1 header + 25 cards
        });
    });

    describe('look', function() {
        it('shows down for face-down cards', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            const result = await board.look('player1');
            const lines = result.split('\n');
            
            // All cards should be face down initially
            for (let i = 1; i < lines.length; i++) {
                assert.strictEqual(lines[i], 'down');
            }
        });

        it('shows my for controlled cards', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            await board.flip('player1', '0x0');
            
            const result = await board.look('player1');
            const lines = result.split('\n');
            
            // First card (0x0) should be "my A" or "my B"
            assert(lines[1]?.startsWith('my '));
        });

        it('shows up for face-up uncontrolled cards', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            await board.flip('player1', '0x0');
            
            const result = await board.look('player2');
            const lines = result.split('\n');
            
            // First card should be "up A" or "up B" for player2
            assert(lines[1]?.startsWith('up '));
        });

        it('shows none for removed cards', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            
            // Flip first card
            const result1 = await board.look('player1');
            const lines1 = result1.split('\n');
            
            // Find first A card
            let firstAIndex = -1;
            for (let i = 1; i < lines1.length; i++) {
                await board.flip('player1', `${Math.floor((i-1) / 5)}x${(i-1) % 5}`);
                const checkResult = await board.look('player1');
                if (checkResult.includes('my A')) {
                    firstAIndex = i;
                    break;
                }
            }
            
            // Find second A card to match
            for (let i = firstAIndex + 1; i < 26; i++) {
                const coord: Coordinate = `${Math.floor((i-1) / 5)}x${(i-1) % 5}`;
                try {
                    await board.flip('player1', coord);
                    const checkResult = await board.look('player1');
                    if (checkResult.split('\n')[i]?.includes('my A')) {
                        // Found matching pair, now flip another card to trigger cleanup
                        await board.flip('player1', '1x1');
                        
                        const finalResult = await board.look('player1');
                        const finalLines = finalResult.split('\n');
                        
                        // The matched cards should be removed (show as 'none')
                        assert.strictEqual(finalLines[firstAIndex], 'none');
                        assert.strictEqual(finalLines[i], 'none');
                        return;
                    }
                } catch (e) {
                    // Continue searching
                }
            }
        });
    });

    describe('Rule 1-A: flip empty space fails', function() {
        it('throws error when flipping removed card', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            
            // Match and remove a pair
            await board.flip('player1', '0x0');
            const firstCard = await board.look('player1');
            const symbol = firstCard.split('\n')[1]?.split(' ')[1];
            
            // Find matching card
            for (let row = 0; row < 5; row++) {
                for (let col = 0; col < 5; col++) {
                    if (row === 0 && col === 0) continue;
                    const coord: Coordinate = `${row}x${col}`;
                    try {
                        await board.flip('player1', coord);
                        const result = await board.look('player1');
                        if (result.includes(`my ${symbol}`) && result.split('\n').filter(l => l.includes('my')).length === 2) {
                            // Matched! Now trigger cleanup
                            await board.flip('player1', '1x1');
                            
                            // Try to flip the removed card
                            await assert.rejects(
                                async () => await board.flip('player2', '0x0'),
                                /Nothing here/
                            );
                            return;
                        }
                    } catch (e) {
                        // Continue
                    }
                }
            }
        });
    });

    describe('Rule 1-B: flip face-down card', function() {
        it('turns card face up and player controls it', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            
            await board.flip('player1', '0x0');
            
            const result = await board.look('player1');
            const lines = result.split('\n');
            
            // Card at 0x0 should be face up and controlled by player1
            assert(lines[1]?.startsWith('my '));
            assert(lines[1] === 'my A' || lines[1] === 'my B');
        });
    });

    describe('Rule 1-C: flip face-up uncontrolled card', function() {
        it('player takes control of face-up card', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            
            // Player1 flips a card, then a non-matching card to release control
            await board.flip('player1', '0x0');
            await board.flip('player1', '0x1');
            
            // Start new turn to trigger cleanup (cards stay up but uncontrolled)
            await board.flip('player1', '1x0');
            
            // Now player2 can take control of the face-up card at 0x0
            await board.flip('player2', '0x0');
            
            const result = await board.look('player2');
            const lines = result.split('\n');
            
            // Card at 0x0 should be controlled by player2
            assert(lines[1]?.startsWith('my '));
        });
    });

    describe('Rule 1-D: flip face-up controlled card waits', function() {
        it('operation waits when card is controlled by another player', async function() {
            this.timeout(5000); // Increase timeout for async operations
            
            const board = await Board.parseFromFile('boards/ab.txt');
            
            // Player1 flips and controls a card
            await board.flip('player1', '0x0');
            
            // Player2 tries to flip the same card - should wait
            const player2Promise = board.flip('player2', '0x0');
            
            // Give it a moment to start waiting
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Player1 should still control the card
            const result1 = await board.look('player1');
            assert(result1.split('\n')[1]?.startsWith('my '));
            
            // Player1 releases by flipping a non-matching second card
            await board.flip('player1', '0x1');
            
            // Now player2's flip should complete
            await player2Promise;
            
            const result2 = await board.look('player2');
            assert(result2.split('\n')[1]?.startsWith('my '));
        });
    });

    describe('Rule 2-A: second card is empty space', function() {
        it('fails and relinquishes control of first card', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            
            // First remove a card by matching
            await board.flip('player1', '0x0');
            const firstCard = await board.look('player1');
            const symbol = firstCard.split('\n')[1]?.split(' ')[1];
            
            // Find and match
            for (let row = 0; row < 5; row++) {
                for (let col = 0; col < 5; col++) {
                    if (row === 0 && col === 0) continue;
                    const coord: Coordinate = `${row}x${col}`;
                    try {
                        await board.flip('player1', coord);
                        const check = await board.look('player1');
                        if (check.includes(`my ${symbol}`) && check.split('\n').filter(l => l.includes('my')).length === 2) {
                            // Trigger cleanup to remove cards
                            await board.flip('player1', '1x0');
                            
                            // Now player2 flips a card then tries the empty space
                            await board.flip('player2', '1x1');
                            
                            await assert.rejects(
                                async () => await board.flip('player2', '0x0'),
                                /Nothing here/
                            );
                            
                            // Player2 should have relinquished control
                            const result = await board.look('player2');
                            assert(!result.includes('my '));
                            return;
                        }
                    } catch (e) {
                        // Continue
                    }
                }
            }
        });
    });

    describe('Rule 2-B: second card is controlled', function() {
        it('fails and relinquishes control of first card without waiting', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            
            // Player1 flips a card
            await board.flip('player1', '0x0');
            
            // Player2 flips a different card
            await board.flip('player2', '0x1');
            
            // Player2 tries to flip player1's controlled card as second card
            await assert.rejects(
                async () => await board.flip('player2', '0x0'),
                /already under control/
            );
            
            // Player2 should have relinquished control of their first card
            const result = await board.look('player2');
            assert(!result.includes('my '));
        });

        it('fails even when trying to flip own controlled card', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            
            // Player1 flips a card
            await board.flip('player1', '0x0');
            
            // Player1 tries to flip the same card again as second card
            await assert.rejects(
                async () => await board.flip('player1', '0x0'),
                /already under control/
            );
        });
    });

    describe('Rule 2-C: second card is face-down', function() {
        it('turns face up', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            
            // Flip two different face-down cards
            await board.flip('player1', '0x0');
            await board.flip('player1', '0x1');
            
            const result = await board.look('player1');
            const lines = result.split('\n');
            
            // Both cards should be face up
            assert(lines[1]?.startsWith('my ') || lines[1]?.startsWith('up '));
            assert(lines[2]?.startsWith('my ') || lines[2]?.startsWith('up '));
        });
    });

    describe('Rule 2-D: matching cards', function() {
        it('player keeps control of both cards', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            
            // Flip first card
            await board.flip('player1', '0x0');
            const firstCheck = await board.look('player1');
            const symbol = firstCheck.split('\n')[1]?.split(' ')[1];
            
            // Find matching card
            for (let row = 0; row < 5; row++) {
                for (let col = 0; col < 5; col++) {
                    if (row === 0 && col === 0) continue;
                    const coord: Coordinate = `${row}x${col}`;
                    
                    await board.flip('player1', coord);
                    const result = await board.look('player1');
                    const controlledCount = result.split('\n').filter(l => l.startsWith('my ')).length;
                    
                    if (controlledCount === 2) {
                        // Successfully matched!
                        assert(result.includes(`my ${symbol}`));
                        return;
                    }
                }
            }
        });
    });

    describe('Rule 2-E: non-matching cards', function() {
        it('player relinquishes control of both cards', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            
            // Flip first A
            await board.flip('player1', '0x0');
            
            // Flip first B (non-matching)
            await board.flip('player1', '0x1');
            
            // Player should not control any cards now
            const result = await board.look('player1');
            const controlledCount = result.split('\n').filter(l => l.startsWith('my ')).length;
            
            assert.strictEqual(controlledCount, 0);
        });
    });

    describe('Rule 3-A: matching pair cleanup', function() {
        it('removes matched cards from board on next first card flip', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            
            // Match a pair
            await board.flip('player1', '0x0');
            const symbol = (await board.look('player1')).split('\n')[1]?.split(' ')[1];
            
            // Find matching card
            for (let row = 0; row < 5; row++) {
                for (let col = 0; col < 5; col++) {
                    if (row === 0 && col === 0) continue;
                    const coord: Coordinate = `${row}x${col}`;
                    
                    await board.flip('player1', coord);
                    const check = await board.look('player1');
                    
                    if (check.split('\n').filter(l => l.startsWith('my ')).length === 2) {
                        // Matched! Now flip a new first card to trigger cleanup
                        await board.flip('player1', '1x0');
                        
                        const result = await board.look('player1');
                        const lines = result.split('\n');
                        
                        // Original matched cards should be removed
                        assert.strictEqual(lines[1], 'none');
                        assert.strictEqual(lines[2 + col - 1 + (row * 5)], 'none');
                        return;
                    }
                }
            }
        });
    });

    describe('Rule 3-B: non-matching cards cleanup', function() {
        it('turns face down uncontrolled non-matching cards on next first card flip', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            
            // Flip two non-matching cards
            await board.flip('player1', '0x0');
            await board.flip('player1', '0x1');
            
            // Cards should be face up but not controlled
            let beforeCleanup = await board.look('player1');
            assert(beforeCleanup.split('\n')[1]?.startsWith('up '));
            assert(beforeCleanup.split('\n')[2]?.startsWith('up '));
            
            // Flip new first card to trigger cleanup
            await board.flip('player1', '1x0');
            
            const result = await board.look('player1');
            const lines = result.split('\n');
            
            // Original cards should be face down now
            assert.strictEqual(lines[1], 'down');
            assert.strictEqual(lines[2], 'down');
        });

        it('does not flip down cards controlled by other players', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            
            // Player1 flips non-matching cards
            await board.flip('player1', '0x0');
            await board.flip('player1', '0x1');
            
            // Player2 takes control of one of those cards
            await board.flip('player2', '0x0');
            
            // Player1 flips new first card to trigger cleanup
            await board.flip('player1', '1x0');
            
            const result = await board.look('player2');
            const lines = result.split('\n');
            
            // Card at 0x0 should still be face up (controlled by player2)
            assert(lines[1]?.startsWith('my '));
            
            // Card at 0x1 should be face down (not controlled)
            assert.strictEqual(lines[2], 'down');
        });
    });

    describe('Concurrency', function() {
        it('handles multiple players playing simultaneously', async function() {
            const board = await Board.parseFromFile('boards/ab.txt');
            
            // Multiple players flip different cards simultaneously
            const promises = [
                board.flip('player1', '0x0'),
                board.flip('player2', '0x1'),
                board.flip('player3', '0x2')
            ];
            
            await Promise.all(promises);
            
            // Each player should control their card
            const result1 = await board.look('player1');
            const result2 = await board.look('player2');
            const result3 = await board.look('player3');
            
            assert(result1.includes('my A'));
            assert(result2.includes('my B'));
            assert(result3.includes('my A'));
        });
    });

    describe('Current bugs', () => {
        it('p2 should wait to gain control over p1\'s matching cards only when p1 selects a new card', async() => {
            const board = await Board.parseFromFile('boards/zoom.txt');

            // 🚚
            await board.flip('p1', '0x0')

            // not awaiting cuz p2 is waiting
            board.flip('p2', '0x0')

            // 🚚
            await board.flip('p1', '2x1') // p2 should still be waiting for p1 to relinquish control

            // 🚂
            await board.flip('p1', '1x1')

            const res1 = await board.look('p1');
            const res2 = await board.look('p2');

            assert(!res1.includes('🚚'))
            assert(res1.includes('my 🚂'))

            assert(!res2.includes('🚚'))
            assert(res2.includes('up 🚂'))
        })

        it('Selecting a correct pair to create empty cards, and then selecting a card that is to be removed from the board should throw Nothing here', async() => {
            const board = await Board.parseFromFile('boards/zoom.txt');

            // Selecting a correct pair to create empty cards
            // 🚚
            await board.flip('p1', '0x0')
            // 🚚
            await board.flip('p1', '2x1')

            // Selecting an empty card
            await assert.rejects(
                async () => await board.flip('p1', '0x0'),
                /Nothing here/
            );

            const res1 = await board.look('p1');
            assert(!res1.includes("up"))
            assert(!res1.includes("my"))
            assert(res1.split('\n').filter(l => l === 'none').length === 2)
        })

        it('If I choose a card, then press it again to give up control, and click another card, the first one should go face down', async() => {
            const board = await Board.parseFromFile('boards/zoom.txt');

            // 🚚
            await board.flip('p1', '0x0')

            // It should return an error that this card is controlled but we ignore it
            try {
                await board.flip('p1', '0x0')
            } catch(ex) {}

            await board.flip('p1', '1x0')

            const res = await board.look('p1');

            assert(!res.includes('🚚'));
        }) 

        it('If p1 flips two non-matching cards, then after p2 selects another card, the p1\'s cards should stay up', async() => {
            const board = await Board.parseFromFile('boards/zoom.txt');

            await board.flip('p1', '0x0');
            await board.flip('p1', '0x1');

            await board.flip('p2', '0x2');

            const res1 = await board.look('p1');
            const lines = res1.split('\n');
            assert(lines[1]?.startsWith('up'));
            assert(lines[2]?.startsWith('up'));
        })

        it('Artiom\'s scenario', async() => {
            const board = await Board.parseFromFile('boards/zoom.txt');

            const c1 = '0x0';
            const c2 = '0x1';
            const c3 = '0x2';
            const c4 = '0x3';

            await board.flip('p1', c1);
            await board.flip('p1', c2);
            // it's not a match, P1 loses control of C1, both cards stay face-up

            await board.flip('p2', c1);
            await board.flip('p2', c3);
            // P2 loses control of C1, both C1 and C3 remain face-up

            await board.flip('p1', c4);

            const res1 = await board.look('p1');
            const lines = res1.split('\n');
            assert(lines[1]?.startsWith("up"))
        })

        it('p1 presses C1, p2 waits for it, p1 presses C1 again to lose control, p2 should win control over C1', async() => {
            const board = await Board.parseFromFile('boards/zoom.txt');

            const c1 = '0x0';
            await board.flip('p1', c1);
            board.flip('p2', c1);

            try {
                await board.flip('p1', c1);
            } catch(ex) {}

            const res2 = await board.look('p2');
            assert(res2.includes('my'));
        })

        it('Alexei\'s case', async() => {
            const board = await Board.parseFromFile('boards/zoom.txt');

            const c1 = '0x0';
            const c2 = '0x1';
            const c3 = '0x2';

            // p1 clicks on c1
            await board.flip('p1', c1);

            // p2 clicks on c2
            await board.flip('p2', c2);

            // p1 clicks on c1 => loses control of the card
            try {
                await board.flip('p1', c1);
            } catch(ex) {}

            // p2 clicks on c3
            await board.flip('p2', c3);

            // Should c1 be flipped down?
            const res1 = await board.look('p1');
            const lines = res1.split('\n');
            assert(lines[1]?.startsWith("up"))
        })

        it('Alexei\'s case number 2', async() => {
            const board = await Board.parseFromFile('boards/zoom.txt');

            await board.flip('p1', '0x0');
            await board.flip('p1', '2x1');

            await board.flip('p1', '0x1');
            try {
                await board.flip('p1', '0x0');
            } catch(ex) {}

            const res1 = await board.look('p1');
            const lines = res1.split('\n');
            assert.strictEqual(lines[2], 'up 🏎');
        })

        it('should flip down the two matching cards after selecting an empty card', async() => {
            const board = await Board.parseFromFile('boards/zoom.txt');

            // Creating clear space
            await board.flip('p1', '0x0');
            await board.flip('p1', '2x1');

            // Selecting two more correct cards
            await board.flip('p1', '0x3');
            await board.flip('p1', '2x4');

            // Selecting an empty space
            await assert.rejects(
                async () => await board.flip('p1', '0x0'),
                /Nothing here/
            );

            // Selecting another down card
            await board.flip('p1', '1x1');

            const card1 = board.cards.get('0x3');
            assert(!card1);

            const card2 = board.cards.get('2x4');
            assert(!card2);
        })

        // it('check comment', async() => {
            // P1 clicks C1, 
            // p2 is waiting for it, 
            // p1 didn’t match his second card so p2 is in control of C1, 
            // p1 is back to waiting for C1 (the second card that p1 match flips down cuz he performed an action), 
            // p2 didnt match his second card but it flips back down instantly
            // Apparently the test case above covers it
        // })
    })
});

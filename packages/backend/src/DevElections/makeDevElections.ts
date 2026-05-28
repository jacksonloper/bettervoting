import * as path from 'path'
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') })

import servicelocator from '../ServiceLocator'
import { DevElectionDefinition, validateDefinition } from './types'

// Import all dev election definitions here
import wizardstar from './elections/wizardstar'
import emailtracking from './elections/emailtracking'
import writeins from './elections/writeins'
import tiechecks from './elections/tiechecks'
import starprordering from './elections/starprordering'

const allDefinitions: DevElectionDefinition[] = [
    wizardstar,
    emailtracking,
    writeins,
    tiechecks,
    starprordering,
];

export interface SeedOptions {
    // Override every dev election's owner_id. On Netlify this is the seeded
    // dev user's Identity UUID; the definitions ship with a placeholder
    // Keycloak UUID for local Keycloak dev.
    ownerId?: string;
    // Delete and recreate elections that already exist.
    force?: boolean;
    // Where to log progress (defaults to console).
    log?: (msg: string) => void;
}

export interface SeedResult {
    processed: string[];
    skipped: string[];
    created: string[];
}

// Callable seeder — usable from a script (main below) or a Netlify function.
// The caller owns the DB lifecycle decision: pass closeDb=false from a
// function (the pooled connection is reused across invocations) and true
// from the one-shot CLI.
export async function seedDevElections(opts: SeedOptions = {}, closeDb = false): Promise<SeedResult> {
    const log = opts.log ?? ((m: string) => console.info(m));
    const force = opts.force ?? false;
    const db = servicelocator.database();

    for (const def of allDefinitions) {
        validateDefinition(def);
    }

    const result: SeedResult = { processed: [], skipped: [], created: [] };
    log(`makedevelections: ${allDefinitions.length} election(s) to process (force=${force}, ownerId=${opts.ownerId ?? '<definition default>'})`);

    for (const def of allDefinitions) {
        log(`\nProcessing: ${def.electionId}`);
        result.processed.push(def.electionId);

        const existing = await db
            .selectFrom('electionDB')
            .selectAll()
            .where('election_id', '=', def.electionId)
            .where('head', '=', true)
            .executeTakeFirst();

        if (existing) {
            if (!force) {
                log(`  Election already exists, skipping (use force to recreate)`);
                result.skipped.push(def.electionId);
                continue;
            }
            log(`  Deleting existing election data...`);
            await db.deleteFrom('ballotDB').where('election_id', '=', def.electionId).execute();
            await db.deleteFrom('electionRollDB').where('election_id', '=', def.electionId).execute();
            await db.deleteFrom('emailEventsDB').where('election_id', '=', def.electionId).execute();
            await db.deleteFrom('electionDB').where('election_id', '=', def.electionId).execute();
        }

        log(`  Inserting election...`);
        const election = { ...def.election };
        // Owner override: this is the one field that has to be a real user for
        // the election to show up in "My Elections" for the seeded dev user.
        if (opts.ownerId) election.owner_id = opts.ownerId;
        election.create_date = new Date().toISOString();
        election.update_date = Date.now().toString();
        election.head = true;
        await db.insertInto('electionDB').values(election).execute();

        const ballots = def.makeBallots();
        log(`  Inserting ${ballots.length} ballot(s)...`);
        await db.insertInto('ballotDB').values(ballots).execute();

        if (def.makeElectionRolls) {
            const rolls = def.makeElectionRolls();
            log(`  Inserting ${rolls.length} election roll(s)...`);
            await db.insertInto('electionRollDB').values(rolls).execute();
        }

        if (def.makeEmailEvents) {
            const events = def.makeEmailEvents();
            log(`  Inserting ${events.length} email event(s)...`);
            for (const event of events) {
                await db.insertInto('emailEventsDB').values(event).execute();
            }
        }

        log(`  Done.`);
        result.created.push(def.electionId);
    }

    log('\nAll dev elections processed.');
    if (closeDb) await db.destroy();
    return result;
}

// CLI entrypoint: `npm run makedevelections [-- --force]`
async function main() {
    const args = process.argv.slice(2);
    await seedDevElections({
        force: args.includes('--force'),
        ownerId: process.env.DEV_USER_ID,
    }, true);
}

// Only run main() when invoked directly (not when imported by a function).
if (require.main === module) {
    main().catch((err) => {
        console.error('makedevelections failed:', err);
        process.exit(1);
    });
}

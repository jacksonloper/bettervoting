import ServiceLocator from '../../ServiceLocator';
import Logger from '../../Services/Logging/Logger';
import { BadRequest } from "@curveball/http-errors";
import { Election, removeHiddenFields } from '@equal-vote/star-vote-shared/domain_model/Election';
import { Race, VotingMethod, MethodTextKey, methodValueToTextKey } from '@equal-vote/star-vote-shared/domain_model/Race';
import { sharedConfig } from '@equal-vote/star-vote-shared/config';
import type { ILoggingContext } from '../../Services/Logging/ILogger';
import { C, body, logCtx, user } from "../../honoTypes";

const ElectionsModel = ServiceLocator.electionsDb();
const ElectionRollModel = ServiceLocator.electionRollDb();

export const getElections = async (c: C) => {
    const ctx = logCtx(c);
    const u = user(c);
    Logger.info(ctx, `getElections`);
    const email = u?.email || '';
    const id = u?.sub || '';

    /////////// ELECTIONS WE OWN ////////////////
    let elections_as_official: Election[] | null = null;
    if ((email !== '' || id !== '') && u?.typ !== 'TEMP_ID') {
        elections_as_official = await ElectionsModel.getElections(id, email, ctx);
        if (!elections_as_official) {
            const msg = "Election does not exist";
            Logger.info(ctx, msg);
            throw new BadRequest(msg);
        }
        elections_as_official.forEach((elec: Election) => removeHiddenFields(elec));
    }

    /////////// ELECTIONS WE'RE INVITED TO ////////////////
    let elections_as_unsubmitted_voter: Election[] | null = null;
    if (email !== '') {
        const myRolls = await ElectionRollModel.getByEmailAndUnsubmitted(email, ctx);
        let election_ids = myRolls?.map(election => election.election_id) ?? [];
        election_ids = election_ids.filter((eid, i) => election_ids.indexOf(eid) === i);
        if (election_ids && election_ids.length > 0) {
            elections_as_unsubmitted_voter = await ElectionsModel.getElectionByIDs(election_ids, ctx);
            elections_as_unsubmitted_voter = elections_as_unsubmitted_voter?.filter(election => election.settings.voter_access !== 'open') ?? null;
        }
    }

    /////////// ELECTIONS WE'VE VOTED IN ////////////////
    let elections_as_submitted_voter: Election[] | null = null;
    if (email !== '') {
        const myRolls = await ElectionRollModel.getByEmailAndSubmitted(email, ctx);
        let election_ids = myRolls?.map(election => election.election_id) ?? [];
        election_ids = election_ids.filter((eid, i) => election_ids.indexOf(eid) === i);
        if (election_ids && election_ids.length > 0) {
            elections_as_submitted_voter = await ElectionsModel.getElectionByIDs(election_ids, ctx);
        }
    }

    return c.json({
        elections_as_official,
        elections_as_unsubmitted_voter,
        elections_as_submitted_voter,
        public_archive_elections: await ElectionsModel.getPublicArchiveElections(ctx),
        open_elections: await ElectionsModel.getOpenElections(ctx),
    });
};

export const queryElections = async (c: C) => {
    const ctx = logCtx(c);
    Logger.info(ctx, `queryElections`);
    const { start_time, end_time } = await body(c);
    return c.json({
        open_elections: await ElectionsModel.getElectionsCreatedInRange(ctx, start_time, end_time),
        closed_elections: [],
        popular_elections: [],
        vote_counts: await ElectionsModel.getBallotCountsForAllElections(ctx),
    });
};

type ElectionMethodKey = MethodTextKey | 'multi_method';

const ALL_METHOD_KEYS: ElectionMethodKey[] = [
    ...(Object.values(methodValueToTextKey) as MethodTextKey[]),
    'multi_method',
];

type GlobalElectionStats =
    { elections: number; votes: number; legacy_elections: number; legacy_votes: number } &
    Record<`${ElectionMethodKey}_votes`, number> &
    Record<`${ElectionMethodKey}_elections`, number>;

export const innerGetGlobalElectionStats = async (ctx: ILoggingContext): Promise<GlobalElectionStats> => {
    Logger.info(ctx, `getGlobalElectionStats `);

    const [electionVotes, electionRaces, sourcedFromPrior] = await Promise.all([
        ElectionsModel.getBallotCountsForAllElections(ctx),
        ElectionsModel.getElectionRacesForAllElections(ctx),
        ElectionsModel.getElectionsSourcedFromPrior(ctx),
    ]);

    const priorElections = sourcedFromPrior?.map(e => e.election_id) ?? [];
    const devElections: string[] = [];

    const electionMethodMap: Record<string, ElectionMethodKey> = {};
    electionRaces?.forEach(e => {
        const methods = new Set((e.races as Race[]).map(r => r.voting_method));
        if (sharedConfig.DEV_USERS.includes(e.owner_id) && !sharedConfig.REAL_ELECTIONS_FROM_DEVS.includes(e.election_id)) {
            devElections.push(e.election_id);
            return;
        }
        if (methods.size === 0) return;
        let methodKey: ElectionMethodKey;
        if (methods.size > 1) {
            methodKey = 'multi_method';
        } else {
            const vm = [...methods][0] as VotingMethod;
            const key = methodValueToTextKey[vm];
            if (!key) return;
            methodKey = key;
        }
        electionMethodMap[e.election_id] = methodKey;
    });

    const legacyVotes = Number(process.env.CLASSIC_VOTE_COUNT ?? 0);
    const legacyElections = Number(process.env.CLASSIC_ELECTION_COUNT ?? 0);

    const stats = {
        elections: legacyElections,
        votes: legacyVotes,
        legacy_elections: legacyElections,
        legacy_votes: legacyVotes,
        ...Object.fromEntries(ALL_METHOD_KEYS.flatMap(k => [[`${k}_votes`, 0], [`${k}_elections`, 0]])),
    } as GlobalElectionStats;

    electionVotes
        ?.filter(m => !devElections.includes(m['election_id']))
        ?.filter(m => !priorElections.includes(m['election_id']))
        ?.filter(m => m['v'] >= 2)
        ?.forEach((m) => {
            const methodKey = electionMethodMap[m['election_id']];
            if (!methodKey) return;
            stats.elections += 1;
            stats.votes += Number(m['v']);
            stats[`${methodKey}_elections`] += 1;
            stats[`${methodKey}_votes`] += Number(m['v']);
        });

    return stats;
};

export const getGlobalElectionStats = async (c: C) => {
    return c.json(await innerGetGlobalElectionStats(logCtx(c)));
};

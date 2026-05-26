import { ElectionResults } from '@equal-vote/star-vote-shared/domain_model/ITabulators';
import Logger from '../../Services/Logging/Logger';
import { VotingMethods } from '../../Tabulators/VotingMethodSelecter';
import { VotingMethod } from '@equal-vote/star-vote-shared/domain_model/Race';
import { C, body, logCtx } from "../../honoTypes";

const className = "Elections.Controllers";

export const getSandboxResults = async (c: C) => {
    const ctx = logCtx(c);
    Logger.info(ctx, `${className}.getSandboxResults`);

    const { candidates: candidateNames, cvr: rawCvr, num_winners, votingMethod } = await body(c);
    const voting_method = votingMethod as VotingMethod;

    if (!(voting_method in VotingMethods)) {
        throw new Error('Invalid Voting Method');
    }

    const candidates = candidateNames.map((name: string, i: number) => ({
        id: name,
        name: name,
        tieBreakOrder: i,
        votesPreferredOver: {},
        winsAgainst: {},
    }));

    const cvr = rawCvr.map((row: number[]) => ({
        marks: Object.fromEntries(row.map((score: number, i: number) => [candidateNames[i], score])),
        overvote_rank: null,
        has_duplicate_rank: null,
    }));

    const results: ElectionResults = VotingMethods[voting_method](candidates, cvr, num_winners);

    return c.json({
        results,
        nWinners: num_winners,
        candidates: candidateNames,
    });
};

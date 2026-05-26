import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { Forbidden } from "@curveball/http-errors";
import { Ballot } from '@equal-vote/star-vote-shared/domain_model/Ballot';
import { expectPermission } from "../controllerUtils";
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { VotingMethods } from '../../Tabulators/VotingMethodSelecter';
import { ElectionResults, candidate, rawVote } from "@equal-vote/star-vote-shared/domain_model/ITabulators";
import { makeWriteInCandidateId } from "@equal-vote/star-vote-shared/utils/makeID";
import { Candidate } from "@equal-vote/star-vote-shared/domain_model/Candidate";
import { trimLower } from "@equal-vote/star-vote-shared/domain_model/Util";
import shuffleCandidatesForRandomTiebreak from "../../Tabulators/shuffleCandidatesForRandomTiebreak";
import { C, election, logCtx, userAuth } from "../../honoTypes";

const BallotModel = ServiceLocator.ballotsDb();

export const getElectionResults = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    const electionId = e.election_id;

    Logger.info(ctx, `getElectionResults: ${electionId}`);

    if (!e.settings.public_results) {
        if (e.state === 'open') {
            const msg = `Preliminary results not enabled for election ${electionId}`;
            Logger.error(ctx, msg);
            throw new Forbidden(msg);
        }
        expectPermission(userAuth(c).roles, permissions.canViewPreliminaryResults);
    }

    const ballots = await BallotModel.getBallotsByElectionID(String(electionId), ctx);

    const results: ElectionResults[] = [];
    for (let race_index = 0; race_index < e.races.length; race_index++) {
        const race = e.races[race_index];
        const useWriteIns = race.enable_write_in && race.write_in_candidates && race.write_in_candidates.length > 0;
        const writeInCandidates = useWriteIns && race.write_in_candidates ? race.write_in_candidates : [];

        const candidates: candidate[] = race.candidates.map((cand: Candidate) => ({
            id: cand.candidate_id,
            name: cand.candidate_name,
            tieBreakOrder: -1,
            votesPreferredOver: {},
            winsAgainst: {},
        }));

        Logger.debug(ctx, `[WriteIn Debug] race=${race.race_id} useWriteIns=${useWriteIns} writeInCandidates=${JSON.stringify(writeInCandidates.map(wc => ({ name: wc.candidate_name, approved: wc.approved, aliases: wc.aliases })))}`);

        if (useWriteIns) {
            writeInCandidates.forEach((wc) => {
                if (wc.approved) {
                    candidates.push({
                        id: makeWriteInCandidateId(wc.candidate_name),
                        name: wc.candidate_name,
                        tieBreakOrder: -1,
                        votesPreferredOver: {},
                        winsAgainst: {},
                    });
                }
            });
        }
        Logger.debug(ctx, `[WriteIn Debug] candidates for tabulation: ${JSON.stringify(candidates.map(cand => ({ id: cand.id, name: cand.name })))}`);

        const race_id = race.race_id;
        const cvr: rawVote[] = [];
        const num_winners = race.num_winners;
        const voting_method = race.voting_method;
        let numUnprocessedWriteIns = 0;
        let numExcludedWriteIns = 0;

        ballots.forEach((ballot: Ballot) => {
            const vote = ballot.votes.find((v) => v.race_id === race_id);
            if (vote) {
                const marks: { [key: string]: number | null } = {};
                vote.scores.forEach(score => {
                    const isRegularCandidate = race.candidates.some((cand: Candidate) => cand.candidate_id === score.candidate_id);
                    if (isRegularCandidate) {
                        if (score.candidate_id in marks) {
                            Logger.warn(ctx, `[Tabulation] Duplicate score for candidate "${score.candidate_id}" on same ballot, keeping first score`);
                        } else {
                            marks[score.candidate_id] = score.score;
                        }
                    } else if (race.enable_write_in && score.write_in_name) {
                        const write_in_name = score.write_in_name;
                        const writeInCandidate = writeInCandidates.find(wc => wc.aliases.includes(trimLower(write_in_name)));
                        Logger.debug(ctx, `[WriteIn Debug] ballot write_in_name="${write_in_name}" matched=${!!writeInCandidate} approved=${writeInCandidate?.approved} matchedAliases=${JSON.stringify(writeInCandidate?.aliases)}`);
                        if (!writeInCandidate) {
                            numUnprocessedWriteIns += 1;
                            numExcludedWriteIns += 1;
                        } else if (writeInCandidate.approved) {
                            const wcId = makeWriteInCandidateId(writeInCandidate.candidate_name);
                            if (!(wcId in marks)) {
                                marks[wcId] = score.score;
                            } else {
                                Logger.warn(ctx, `[WriteIn] Duplicate write-in score for "${writeInCandidate.candidate_name}" on same ballot, keeping first score`);
                            }
                        } else {
                            numExcludedWriteIns += 1;
                        }
                    }
                });
                cvr.push({
                    marks,
                    overvote_rank: vote?.overvote_rank,
                    has_duplicate_rank: vote?.has_duplicate_rank,
                });
            }
        });

        if (candidates.length < 1) {
            results[race_index] = {
                votingMethod: voting_method,
                elected: [],
                tied: [],
                other: [],
                roundResults: [],
                summaryData: {
                    candidates,
                    nOutOfBoundsVotes: 0,
                    nAbstentions: 0,
                    nTallyVotes: 0,
                    nOvervotes: 0,
                },
                tieBreakType: 'none',
                perm: [],
                writeInDiagnostics: race.enable_write_in ? {
                    numScoresDisregardedForUnprocessed: numUnprocessedWriteIns,
                    numScoresDisregarded: numExcludedWriteIns,
                } : undefined,
            } as unknown as ElectionResults;
            continue;
        }

        if (!VotingMethods[voting_method]) {
            throw new Error(`Invalid Voting Method: ${voting_method}`);
        }

        shuffleCandidatesForRandomTiebreak(e.create_date, candidates, cvr.length, race.race_id);
        const perm = candidates.map(cand => cand.id);

        Logger.info(ctx, `Tabulating results for ${voting_method} election`);
        const tabulationResult = VotingMethods[voting_method](candidates, cvr, num_winners, e.settings);
        results[race_index] = {
            ...tabulationResult,
            perm,
            // @ts-ignore - roundResults is a complicated discriminated type
            roundResults: tabulationResult.roundResults.map(rr => ({
                ...rr,
                logs: rr.logs.map(log => {
                    if (typeof log === 'object' && log.key.includes('random')) return {
                        ...log,
                        tiebreak_candidate_names: candidates.map(cand => cand.name).join(', '),
                    };
                    return log;
                }),
            })),
            writeInDiagnostics: race.enable_write_in ? {
                numScoresDisregardedForUnprocessed: numUnprocessedWriteIns,
                numScoresDisregarded: numExcludedWriteIns,
            } : undefined,
        };
    }

    return c.json({ election: e, results });
};

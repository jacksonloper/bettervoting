import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { BadRequest } from "@curveball/http-errors";
import { Ballot } from '@equal-vote/star-vote-shared/domain_model/Ballot';
import { Score } from '@equal-vote/star-vote-shared/domain_model/Score';
import { expectPermission } from "../controllerUtils";
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { VotingMethods } from '../../Tabulators/VotingMethodSelecter';
import { IElectionRequest } from "../../IRequest";
import { Response, NextFunction } from 'express';
import { vote, ElectionResults, candidate, rawVote } from "@equal-vote/star-vote-shared/domain_model/ITabulators";
import { Candidate } from "@equal-vote/star-vote-shared/domain_model/Candidate";
import { matchesWriteInCandidate } from "@equal-vote/star-vote-shared/domain_model/WriteIn";
var seedrandom = require('seedrandom');

const BallotModel = ServiceLocator.ballotsDb();

const getElectionResults = async (req: IElectionRequest, res: Response, next: NextFunction) => {
    var electionId = req.election.election_id;
    Logger.info(req, `getElectionResults: ${electionId}`);

    if (!req.election.settings.public_results) {
        expectPermission(req.user_auth.roles, permissions.canViewPreliminaryResults)
    }

    const ballots = await BallotModel.getBallotsByElectionID(String(electionId), req);
    if (!ballots) {
        const msg = `Ballots not found for Election ${electionId}`;
        Logger.info(req, msg);
        throw new BadRequest(msg);
    }

    // For 0 or 1 ballots, return empty results (frontend will show appropriate message)
    if (ballots.length <= 1) {
        Logger.info(req, `Insufficient ballots (${ballots.length}) to compute full results for election ${electionId}`);
        res.json({
            election: req.election,
            results: []
        })
        return
    }

    const election = req.election
    let results: ElectionResults[] = []
    for (let race_index = 0; race_index < election.races.length; race_index++) {
        const race = election.races[race_index]
        const useWriteIns = race.enable_write_in && race.write_in_candidates && race.write_in_candidates.length > 0
        const writeInCandidates = useWriteIns ? race.write_in_candidates : []

        // Build candidates list including write-ins
        const candidates: candidate[] = race.candidates.map((c: Candidate, i) => ({
            id: c.candidate_id,
            name: c.candidate_name,
            // These will be set later
            tieBreakOrder: i,
            votesPreferredOver: {},
            winsAgainst: {}
        }))

        // Add approved write-in candidates to the candidates list
        if (useWriteIns && writeInCandidates) {
            writeInCandidates.forEach((wc, i) => {
                if (wc.approved) {
                    candidates.push({
                        id: `write-in-${i}`,
                        name: wc.candidate_name,
                        tieBreakOrder: race.candidates.length + i,
                        votesPreferredOver: {},
                        winsAgainst: {}
                    })
                }
            })
        }

        const race_id = race.race_id
        const cvr: rawVote[] = []
        const num_winners = race.num_winners
        const voting_method = race.voting_method
        let numUnprocessedWriteIns = 0

        ballots.forEach((ballot: Ballot) => {
            const vote = ballot.votes.find((vote) => vote.race_id === race_id)
            if (vote) {
                const marks: { [key: string]: number | null } = {}

                vote.scores.forEach(score => {
                    if (score.candidate_id) {
                        // Regular candidate
                        marks[score.candidate_id] = score.score
                    } else if (useWriteIns && score.write_in_name && writeInCandidates) {
                        // Write-in candidate - find which approved write-in it matches
                        const write_in_name = score.write_in_name
                        const writeInIndex = writeInCandidates.findIndex(wc =>
                            matchesWriteInCandidate(write_in_name, wc)
                        )
                        if (writeInIndex < 0) {
                            numUnprocessedWriteIns += 1
                        } else if (writeInCandidates[writeInIndex].approved) {
                            marks[`write-in-${writeInIndex}`] = score.score
                        }
                    }
                })

                cvr.push({
                    marks: marks,
                    overvote_rank: vote?.overvote_rank,
                    has_duplicate_rank: vote?.has_duplicate_rank,
                })
            }
        })

        if (!VotingMethods[voting_method]) {
            throw new Error(`Invalid Voting Method: ${voting_method}`)
        }
        const msg = `Tabulating results for ${voting_method} election`
        Logger.info(req, msg);
        const tabResults = VotingMethods[voting_method](candidates, cvr, num_winners, election.settings) as any
        tabResults.numUnprocessedWriteIns = useWriteIns ? numUnprocessedWriteIns : undefined
        results[race_index] = tabResults
    }
    
    res.json(
        {
            election: election,
            results: results
        }
    )
}

export {
    getElectionResults
}

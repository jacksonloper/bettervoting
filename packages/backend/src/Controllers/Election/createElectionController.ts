import { Election, electionValidation } from "@equal-vote/star-vote-shared/domain_model/Election";
import ServiceLocator from "../../ServiceLocator";
import Logger from "../../Services/Logging/Logger";
import { InternalServerError, BadRequest } from "@curveball/http-errors";
import type { ILoggingContext } from "../../Services/Logging/ILogger";
import { expectValidElection } from "../controllerUtils";
import { C, body, logCtx } from "../../honoTypes";

const ElectionsModel = ServiceLocator.electionsDb();

const failMsgPrfx = "CATCH:  create error election err: ";

export async function createElectionController(c: C) {
    const ctx = logCtx(c);
    Logger.info(ctx, "Create Election Controller");
    const { Election: inputBody } = await body(c);
    const inputElection = await expectValidElection(ctx, inputBody);
    const resElection = await createAndCheckElection(inputElection, ctx);
    return c.json({ election: resElection }, 200);
}

const createAndCheckElection = async (
    inputElection: Election,
    ctx: ILoggingContext
): Promise<Election> => {
    const validationFailure = electionValidation(inputElection);
    if (validationFailure) {
        Logger.error(ctx, validationFailure);
        throw new BadRequest(validationFailure);
    }
    const newElection = await ElectionsModel.createElection(
        inputElection,
        ctx,
        `User Creates new election`
    );
    if (!newElection) {
        const failMsg = "Election not created";
        Logger.error(ctx, failMsgPrfx + failMsg);
        throw new InternalServerError(failMsg);
    }
    return newElection;
};

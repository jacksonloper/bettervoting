import ServiceLocator from '../../ServiceLocator';
import Logger from '../../Services/Logging/Logger';
import { permissions } from '@equal-vote/star-vote-shared/domain_model/permissions';
import { expectPermission } from "../controllerUtils";
import { BadRequest, InternalServerError } from "@curveball/http-errors";
import { Invites } from "../../Services/Email/EmailTemplates";
import { ElectionRoll } from '@equal-vote/star-vote-shared/domain_model/ElectionRoll';
import { Uid } from "@equal-vote/star-vote-shared/domain_model/Uid";
import { Election } from '@equal-vote/star-vote-shared/domain_model/Election';
import { randomUUID } from "crypto";
import { logSafeHash } from '../../Services/Logging/logSafeHash';
import type { ILoggingContext } from '../../Services/Logging/ILogger';
import { C, election, logCtx, user, userAuth } from "../../honoTypes";

const ElectionRollModel = ServiceLocator.electionRollDb();
const EmailService = ServiceLocator.emailService();
const EmailEventsDB = ServiceLocator.emailEventsDb();
const EventQueue = ServiceLocator.eventQueue();

const className = "election.Controllers";
const SendInviteEventQueue = "sendInviteEvent";

export type SendInviteEvent = {
    requestId: Uid;
    election: Election;
    url: string;
    electionRoll: ElectionRoll;
    sender: string;
};

export const sendInvitationsController = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    Logger.info(ctx, `${className}.sendInvitations ${e.election_id}`);
    expectPermission(userAuth(c).roles, permissions.canSendEmails);

    const electionId = e.election_id;
    let electionRoll: ElectionRoll[] | null = null;
    if (e.settings.voter_access === 'closed' && e.settings.invitation === 'email') {
        electionRoll = await ElectionRollModel.getRollsByElectionID(electionId, ctx);
    }
    if (!electionRoll) {
        const msg = `Election roll for ${electionId} not found`;
        Logger.info(ctx, msg);
        throw new BadRequest(msg);
    }

    const electionRollFiltered = electionRoll.filter(roll => {
        if (!roll.email_data) return true;
        if (!roll.email_data.inviteResponse) return true;
        if (!(roll.email_data.inviteResponse.length > 0)) return true;
        if (!(roll.email_data.inviteResponse[0].statusCode < 400)) return true;
        return false;
    });
    if (electionRollFiltered.length === 0) {
        throw new BadRequest('All email invites have already been sent');
    }

    await sendBatchEmailInvites(ctx, user(c).email, electionRollFiltered, e);
    return c.json({});
};

export async function sendBatchEmailInvites(ctx: ILoggingContext, senderEmail: string, electionRoll: ElectionRoll[], e: Election) {
    const Jobs: SendInviteEvent[] = [];
    const reqId = ctx.contextId ?? randomUUID();
    const url = ServiceLocator.globalData().mainUrl;
    electionRoll.forEach(roll => {
        Jobs.push({ requestId: reqId, election: e, url, electionRoll: roll, sender: senderEmail });
    });

    const failMsg = "Failed to send invitations";
    Logger.info(ctx, `${className}.sendInvitations`, { election_id: e.election_id });
    try {
        await (await EventQueue).publishBatch(SendInviteEventQueue, Jobs);
    } catch (err: any) {
        const msg = `Could not send invitations`;
        Logger.error(ctx, `${msg}: ${err.message}`);
        throw new InternalServerError(failMsg);
    }
}

export const sendInvitationController = async (c: C) => {
    const ctx = logCtx(c);
    const e = election(c);
    const voter_id = c.req.param('voter_id');
    Logger.info(ctx, `${className}.sendInvite ${e.election_id} ${logSafeHash(voter_id ?? '')}`);
    expectPermission(userAuth(c).roles, permissions.canSendEmails);

    if (!(e.settings.voter_access === 'closed' && e.settings.invitation === 'email')) {
        throw new BadRequest('Email invitations not enabled');
    }
    const url = ServiceLocator.globalData().mainUrl;
    const electionId = e.election_id;

    if (!voter_id) throw new BadRequest('Voter ID not specified');
    const roll = await ElectionRollModel.getByVoterID(electionId, voter_id, ctx);
    if (!roll) {
        Logger.error(ctx, `Could not find voter ${logSafeHash(voter_id)}`);
        throw new InternalServerError('Could not find voter');
    }

    const updated = await sendInvitation(ctx, e, roll, user(c).email, url);
    return c.json({ electionRoll: updated }, 200);
};

export async function handleSendInviteEvent(job: { id: string; data: SendInviteEvent }): Promise<void> {
    const event = job.data;
    const ctx = Logger.createContext(event.requestId);
    const roll = await ElectionRollModel.getByVoterID(event.election.election_id, event.electionRoll.voter_id, ctx);
    if (!roll) {
        Logger.error(ctx, `Could not find voter ${logSafeHash(event.electionRoll.voter_id)}`);
        throw new InternalServerError('Could not find voter');
    }
    await sendInvitation(ctx, event.election, roll, event.sender, event.url);
}

async function sendInvitation(ctx: ILoggingContext, election: Election, electionRoll: ElectionRoll, sender: string, url: string) {
    const invites = Invites(election, [electionRoll], url);
    const emailResponse = await EmailService.sendEmails(invites);
    if (!electionRoll.email_data) electionRoll.email_data = {};

    let emailSuccess = false;
    if (emailResponse.length > 0) {
        electionRoll.email_data.inviteResponse = emailResponse[0];
        if (emailResponse[0][0].statusCode < 400) emailSuccess = true;
    } else {
        electionRoll.email_data.inviteResponse = emailResponse;
    }

    const xMessageId = emailResponse?.[0]?.[0]?.headers?.['x-message-id'];
    if (xMessageId) {
        try {
            await EmailEventsDB.insert({
                message_id: xMessageId,
                election_id: election.election_id,
                voter_id: electionRoll.voter_id,
                event_type: 'sent',
                event_timestamp: new Date().toISOString(),
                details: { status_code: emailResponse?.[0]?.[0]?.statusCode },
            }, ctx);
        } catch (err: any) {
            Logger.error(ctx, `Could not insert email event: ${err.message}`);
        }
    }

    if (electionRoll.history == null) electionRoll.history = [];
    electionRoll.history.push({
        action_type: `email invite sent: ${emailSuccess ? 'success' : 'failed'}`,
        actor: sender,
        timestamp: Date.now(),
    });
    try {
        const updated = await ElectionRollModel.update(electionRoll, ctx, `Email Invite Sent`);
        if (!updated) throw new InternalServerError();
        return updated;
    } catch (err: any) {
        const msg = `Could not update election roll`;
        Logger.error(ctx, `${msg}: ${err.message}`);
        throw new InternalServerError(msg);
    }
}

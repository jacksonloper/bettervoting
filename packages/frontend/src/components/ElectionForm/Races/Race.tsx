import { useState } from "react"
import Typography from '@mui/material/Typography';
import { Box, Paper, Tooltip, Badge } from "@mui/material"
import IconButton from '@mui/material/IconButton'
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import WarningIcon from '@mui/icons-material/Warning';
import RaceDialog from './RaceDialog';
import { useEditRace } from './useEditRace';
import RaceForm from './RaceForm';
import useElection from '../../ElectionContextProvider';
import { ContentCopy } from '@mui/icons-material';
import { Race as IRace } from "@equal-vote/star-vote-shared/domain_model/Race";
import { Link } from 'react-router-dom';

export interface NewRace extends Omit<IRace, 'voting_method'> {
    voting_method: "STAR" | "STAR_PR" | "Approval" | "RankedRobin" | "IRV" | "Plurality" | "STV" | ""
}
interface RaceProps {
    race: IRace
    race_index: number
}

export default function Race({ race, race_index }: RaceProps) {

    const { election, results, permissions } = useElection()
    const { editedRace, errors, setErrors, applyRaceUpdate, onSaveRace, onDeleteRace, onDuplicateRace } = useEditRace(race, race_index)

    const [open, setOpen] = useState(false);
    const handleOpen = () => setOpen(true);
    const handleClose = () => setOpen(false);

    const [activeStep, setActiveStep] = useState(0);
    const resetStep = () => setActiveStep(0);

    const numUnprocessedWriteIns = race.enable_write_in && results && results[race_index]?.numUnprocessedWriteIns
        ? results[race_index].numUnprocessedWriteIns
        : 0;

    const canProcessWriteIns = permissions && permissions.includes('canProcessWriteIns');
    const showWriteInBadge = race.enable_write_in && election.state !== 'draft';

    const onSave = async () => {
        const success = await onSaveRace()
        if (!success) return
        handleClose()
    }

    const onCopy = async () => {
        const success = await onDuplicateRace()
        if (!success) return
    }

    return (
        <Paper elevation={4} sx={{ width: '100%'}}>
            <Box
                sx={{ display: 'flex', bgcolor: 'background.paper', borderRadius: 10 }}
                alignItems={'center'}
            >
                <Box sx={{ width: '100%', pl: 2 }}>
                    <Typography variant="h5" component="h5">{race.title}</Typography>
                </Box>
                {showWriteInBadge && (
                    <Box sx={{ flexShrink: 1, p: 1 }}>
                        <Tooltip title={
                            !canProcessWriteIns
                                ? 'Write-ins enabled (no permission to process)'
                                : numUnprocessedWriteIns > 0
                                    ? `${numUnprocessedWriteIns} unprocessed write-in${numUnprocessedWriteIns > 1 ? 's' : ''}`
                                    : 'All write-ins processed'
                        }>
                            <IconButton
                                aria-label='Process write-ins'
                                component={canProcessWriteIns ? Link : 'button'}
                                to={canProcessWriteIns ? `/${election.election_id}/admin/writeins/${race.race_id}` : undefined}
                                disabled={!canProcessWriteIns}
                                sx={{ color: !canProcessWriteIns ? 'text.disabled' : numUnprocessedWriteIns > 0 ? 'error.main' : 'success.main' }}
                            >
                                <Badge
                                    badgeContent={numUnprocessedWriteIns > 0 ? numUnprocessedWriteIns : '✓'}
                                    color={!canProcessWriteIns ? 'default' : numUnprocessedWriteIns > 0 ? 'error' : 'success'}
                                >
                                    <WarningIcon />
                                </Badge>
                            </IconButton>
                        </Tooltip>
                    </Box>
                )}
                <Box sx={{ flexShrink: 1, p: 1 }}>
                    <Tooltip title='Duplicate'>
                        <IconButton
                            aria-label='Duplicate'
                            onClick={onCopy}
                            disabled={election.state !== 'draft'}>
                            <ContentCopy />
                        </IconButton>
                    </Tooltip>
                </Box>
                <Box sx={{ flexShrink: 1, p: 1 }}>
                    <Tooltip title='Edit'>
                        <IconButton
                            aria-label={`Edit Race: ${race.title}`}
                            onClick={handleOpen}>
                            {election.state === 'draft' ? <EditIcon /> : <VisibilityIcon />}
                        </IconButton>
                    </Tooltip>
                </Box>
                <Box sx={{ flexShrink: 1, p: 1 }}>
                    <Tooltip title='Delete'>
                        <IconButton
                            aria-label={`Delete Race: ${race.title}`}
                            color="error"
                            onClick={onDeleteRace}
                            disabled={election.state !== 'draft'}>
                            <DeleteIcon />
                        </IconButton>
                    </Tooltip>
                </Box>

            </Box>
            <RaceDialog
              onSaveRace={onSave}
              open={open}
              handleClose={handleClose}
              resetStep={resetStep}
            >
                <RaceForm
                    race_index={race_index}
                    editedRace={editedRace}
                    errors={errors}
                    setErrors={setErrors}
                    applyRaceUpdate={applyRaceUpdate}
                    activeStep={activeStep}
                    setActiveStep={setActiveStep}
                />
            </RaceDialog>
        </Paper >
    )
}

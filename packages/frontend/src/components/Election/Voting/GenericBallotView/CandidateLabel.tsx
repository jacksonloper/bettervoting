import { Box, IconButton, Link, TextField, Typography } from '@mui/material';
import { Candidate } from '@equal-vote/star-vote-shared/domain_model/Candidate';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DeleteIcon from '@mui/icons-material/Delete';
import { useContext, useState } from 'react';
import { BallotContext } from '../VotePage';

interface CandidateLabelProps {
  candidate: Candidate;
  candidateIndex: number;
  gridArea: any;
}
export default function CandidateLabel({ candidate, candidateIndex, gridArea }: CandidateLabelProps) {
  const ballotContext = useContext(BallotContext);

  const handleWriteInChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newName = event.target.value;
    if (ballotContext.updateWriteInName) {
      ballotContext.updateWriteInName(candidateIndex, newName);
    }
  };

  const handleRemoveWriteIn = () => {
    if (ballotContext.removeWriteInCandidate) {
      ballotContext.removeWriteInCandidate(candidateIndex);
    }
  };

  if (candidate.is_write_in) {
    return (
      <Box
        sx={{
          gridArea: gridArea,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}>
        <TextField
          placeholder="Write-in candidate name"
          value={candidate.candidate_name}
          onChange={handleWriteInChange}
          size="small"
          sx={{
            flex: 1,
            mx: {
              xs: 0,
              sm: '10px',
            },
            my: {
              xs: 0,
              sm: '8px',
            },
          }}
        />
        <IconButton
          onClick={handleRemoveWriteIn}
          size="small"
          aria-label="Remove write-in candidate"
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon />
        </IconButton>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        gridArea: gridArea,
      }}>
      <Typography className="rowHeading" align='left' variant="h6" component="h6" sx={{
        wordBreak: "break-word",
        px: {
          xs: 0,
          sm: '10px',
        },
        my: {
          xs: 0,
          sm: '16px',
        },
        textAlign: {
          xs: 'center',
          sm: 'left',
        },
        width: '100%'
      }}>
        {candidate.candidate_url && <Link href={candidate.candidate_url} target='_blank'>{candidate.candidate_name}<OpenInNewIcon sx={{ height: 15 }} /></Link>}
        {!candidate.candidate_url && candidate.candidate_name}
      </Typography>
    </Box>
  );
}
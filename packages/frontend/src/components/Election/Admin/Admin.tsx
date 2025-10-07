import Container from '@mui/material/Container';
import ViewElectionRolls from "./ViewElectionRolls";
import { Routes, Route } from 'react-router-dom'
import EditRoles from './EditRoles';
import ViewBallots from './ViewBallots';
import AdminHome from './AdminHome';
import WriteInProcessing from './WriteInProcessing';

const Admin = () => {
    return (
        <Container>
            <Routes>
                <Route path='/' element={<AdminHome />} />
                <Route path='/voters' element={<ViewElectionRolls />} />
                <Route path='/roles' element={<EditRoles />} />
                <Route path='/ballots' element={<ViewBallots />} />
                <Route path='/writeins/:race_id' element={<WriteInProcessing />} />
            </Routes>
        </Container>
    )
}

export default Admin

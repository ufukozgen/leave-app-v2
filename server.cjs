require('dotenv').config();
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cors = require('cors');

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
const managerRequests = require('./api/manager-requests');
app.get('/api/manager-requests', managerRequests);


const approveLeaveRequest = require('./api/approve-leave-request.js') 
const createLeaveRequest = require('./api/create-leave-request.js')
const cancelLeaveRequest = require('./api/cancel-leave-request.js')
const rejectLeaveRequest = require('./api/reject-leave-request.js')
const deductLeave = require('./api/deduct-leave.js');
const reverseLeave = require('./api/reverse-leave.js')
const updateLeaveBalance = require('./api/update-leave-balance.js')

app.post('/api/approve-leave-request', approveLeaveRequest);
app.post('/api/create-leave-request', createLeaveRequest);
app.post('/api/cancel-leave-request', cancelLeaveRequest);
app.post('/api/reject-leave-request', rejectLeaveRequest);
app.post('/api/deduct-leave', deductLeave);
app.post('/api/reverse-leave', reverseLeave);
app.post('/api/update-leave-balance', updateLeaveBalance);



// ...your other API routes...

const PORT = 4000;
app.listen(PORT, () => console.log(`API server running on port ${PORT}`));

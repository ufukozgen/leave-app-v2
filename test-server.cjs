const express = require('express');
const app = express();

app.use(express.json());

app.post('/api/test', (req, res) => {
  res.json({ hello: "world", body: req.body });
});

app.listen(4000, () => console.log("TEST API on 4000"));

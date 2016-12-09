'use strict';

const express = require('express');
const app = express();
const path = require('path');
const port = 5000;

app.use('/js', express.static(path.resolve(__dirname, 'src')));
app.use('/styles', express.static(path.resolve(__dirname, 'examples/styles')));
app.use(express.static(path.resolve(__dirname, 'examples')));


app.listen(port, function () {
    console.log('Listening on port', port)
});
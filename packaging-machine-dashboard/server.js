const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

//Imports for File Download
const fs = require('fs');
const path = require('path');
const csv = require('fast-csv');

const app = express();
app.use(cors());
app.use(express.json());



// PostgreSQL connection
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'production_monitoring',
    password: 'Aditya123',
    port: 5432,
});



// Helper function to get current time in IST
function getCurrentTimeIST() {
    return new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
}

// Define the getInitialState function
function getInitialState() {
    return {
        machineData: {
            machineName: "Ishida-aeZ4K88",
            batch: "xy",
            batchSize: 6000,
            product: "Lays",
            startTime: null,
            runningTime: 0,
            stopTime: 0,
            isRunning: false,
            hasStarted: false
        },
        productionData: [],
        globalStartTime: null,
        lastPauseTime: null,
        totalStopTimeSeconds: 0
    };
}



// Initialize state
let { machineData, productionData, globalStartTime, lastPauseTime, totalStopTimeSeconds } = getInitialState();



function getCurrentTimeInSeconds() {
    return Math.floor(new Date(getCurrentTimeIST()).getTime() / 1000);
}



function updateTimes() {
    if (!machineData.hasStarted) return;

    const currentTimeSeconds = getCurrentTimeInSeconds();
    if (machineData.isRunning) {
        machineData.runningTime = currentTimeSeconds - Math.floor(new Date(globalStartTime).getTime() / 1000) - totalStopTimeSeconds;
        machineData.stopTime = totalStopTimeSeconds; // Update stop time
        console.log(`Running Time Updated: ${machineData.runningTime}s, Total Stop Time: ${totalStopTimeSeconds}s`);
    } else if (lastPauseTime) {
        const currentStopDurationSeconds = currentTimeSeconds - Math.floor(new Date(lastPauseTime).getTime() / 1000);
        machineData.stopTime = totalStopTimeSeconds + currentStopDurationSeconds;
        console.log(`Stop Time Updated: ${machineData.stopTime}s, Current Stop Duration: ${currentStopDurationSeconds}s`);
    }
}



// Function to insert data into the database
async function insertProductionData(data) {
    const { batch, batchSize, product, startTime, runningTime, stopTime, actualValue, expectedValue } = data;
    const efficiency = expectedValue > 0 ? (actualValue / expectedValue) * 100 : 0;

    const query = `
        INSERT INTO production_data 
        (batch, batch_size, product, start_time, running_time, stop_time, actual_value, expected_value, efficiency)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    try {
        await pool.query(query, [
            batch, batchSize, product, startTime, runningTime, stopTime, actualValue, expectedValue, efficiency
        ]);
        console.log('Data inserted successfully');
    } catch (err) {
        console.error('Error inserting data', err);
    }
}



// Generate dummy data every 5 seconds and insert into database
const dataGenerationInterval = setInterval(async () => {
    if (!machineData.hasStarted) return;

    updateTimes();

    const time = new Date(getCurrentTimeIST()).toLocaleTimeString();
    let newDataPoint;

    if (machineData.isRunning) {
        const packetsManufactured = Math.floor(Math.random() * (20 - 10 + 1) + 10);
        newDataPoint = {
            time: time,
            actualProduction: packetsManufactured,
            expectedProduction: 20 // Maximum efficiency
        };

        // Insert data into the database
        await insertProductionData({
            batch: machineData.batch,
            batchSize: machineData.batchSize,
            product: machineData.product,
            startTime: machineData.startTime,
            runningTime: machineData.runningTime,
            stopTime: machineData.stopTime,
            actualValue: packetsManufactured,
            expectedValue: 20
        });
    } else {
        newDataPoint = {
            time: time,
            actualProduction: 0,
            expectedProduction: 0
        };
    }

    productionData.push(newDataPoint);

    if (productionData.length > 60) {
        productionData.shift();
    }
}, 5000);




//----------------END POINTS------------------------//


// UPPER LEFT MACHINE DETAILS 
app.get('/api/machine', (req, res) => {
    updateTimes();
    res.json(machineData);
});


// FOR GRAPH
app.get('/api/production', (req, res) => {
    updateTimes();
    const totalActual = productionData.reduce((sum, p) => sum + p.actualProduction, 0);
    const totalExpected = productionData.reduce((sum, p) => sum + p.expectedProduction, 0);

    res.json({
        expectedProduction: totalExpected,
        actualProduction: totalActual,
        productionData: productionData,
        isRunning: machineData.isRunning,
        hasStarted: machineData.hasStarted,
        runningTime: machineData.runningTime,
        stopTime: machineData.stopTime
    });
});



// START BUTTON
app.post('/api/start', (req, res) => {
    if (!machineData.isRunning) {
        const currentTime = getCurrentTimeIST();
        machineData.isRunning = true;
        machineData.hasStarted = true;
        if (!globalStartTime) {
            globalStartTime = currentTime;
            machineData.startTime = new Date(currentTime).toLocaleTimeString();
        }
        if (lastPauseTime) {
            const pauseDurationSeconds = Math.floor((new Date(currentTime).getTime() - new Date(lastPauseTime).getTime()) / 1000);
            totalStopTimeSeconds += pauseDurationSeconds;
            console.log(`Production Started. Added pause duration: ${pauseDurationSeconds}s. Total Stop Time: ${totalStopTimeSeconds}s`);
            lastPauseTime = null;
        } else {
            console.log('Production Started. No previous pause.');
        }
        machineData.stopTime = totalStopTimeSeconds; // Reset stop time when starting
        res.json({ message: 'Production started' });
    } else {
        res.status(400).json({ message: 'Production is already running' });
    }
});



// PAUSE BUTTON
app.post('/api/pause', (req, res) => {
    if (machineData.isRunning) {
        machineData.isRunning = false;
        lastPauseTime = getCurrentTimeIST();
        updateTimes(); // Update times immediately when pausing
        console.log(`Production Paused at: ${new Date(lastPauseTime).toLocaleString()}`);
        res.json({ message: 'Production paused' });
    } else {
        res.status(400).json({ message: 'Production is already paused' });
    }
});



// RESET BUTTON
app.post('/api/reset', (req, res) => {
    // Reset all variables to initial state
    ({ machineData, productionData, globalStartTime, lastPauseTime, totalStopTimeSeconds } = getInitialState());
    console.log('Production reset to initial state');
    res.json({ message: 'Production reset successfully' });
});


// Endpoint for downloading Data, On Button Click 
app.get('/api/download-data',async(req,res)=>{
    try{
        const result=await pool.query('SELECT * FROM production_data ORDER BY created_at DESC');

        //this is the file name that would be downloaded
        const filename='production_data.csv';
        //this would be to define the total file path, till the current directory
        const csvFile=path.join(__dirname,filename);

        //this would be for, as data is being fetched , then headers must be present(column names)
        const csvStream=csv.format({headers:true});
        //creates a writeStream to the file location
        const writeStream=fs.createWriteStream(csvFile);

        // whatever goes to csvStream must be in CSV
        csvStream.pipe(writeStream);

        result.rows.forEach((row)=>{
            csvStream.write(row);
        })

        csvStream.end();

        writeStream.on('finish', function(){
            res.download(csvFile,filename,(err)=>{
                if(err){
                    console.error('Error downloading file: ', err);
                    res.status(500).send("Error downloading file");
                }
                fs.unlinkSync(csvFile);
            })
        });
    }
    catch(err){
        console.error('Error fetching data for download', err);
        res.status(500).json({error: "An error occured while fetching data"})
    }
});



//New endpoint to fetch historical data from the database
app.get('/api/historical-data', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM production_data ORDER BY created_at DESC LIMIT 100');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching historical data', err);
        res.status(500).json({ error: 'An error occurred while fetching historical data' });
    }
});



app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
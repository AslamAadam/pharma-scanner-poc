// Global variables
const video = document.getElementById('camera');
const canvas = document.getElementById('snapshot');
const notifications = document.getElementById('notifications');
const textOverlay = document.getElementById('text-overlay');
const apiKey = 'AIzaSyA2fsyqxjPdaeD-0p5AwD_7yoDyXpYVxIQ'; 
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycby_7yH-CqjEiRda7NyDJs1_eeD6duZ3y_lRT9T9_ZTzWxkvdCHoNcFhPXYDO9s40f1Ucg/exec";
let detectedBarcodes = [];
let detectedText = []; // Will be populated by Vision API text detection
let inventoryData = [];
let isScanning = false;
let stream = null;
let dynamsoftInitialized = false;
let barcodeReaderInstance = null;
let lastVerificationResult = { nonReportedItems: [] };

// === For Vision API Object Colors ===
let objectColors = {};
let availableColors = [
    '#FF6347', '#4682B4', '#32CD32', '#FFD700', '#6A5ACD',
    '#FF4500', '#20B2AA', '#9370DB', '#00FA9A', '#DA70D6',
    '#FF7F50', '#87CEEB', '#ADFF2F', '#FFA07A', '#BA55D3'
];
let nextColorIndex = 0;

function getObjectColor(objectName) {
    const normalizedName = objectName.toLowerCase();
    if (!objectColors[normalizedName]) {
        objectColors[normalizedName] = availableColors[nextColorIndex % availableColors.length];
        nextColorIndex++;
    }
    return objectColors[normalizedName];
}

// Check if the app is running over HTTPS
function checkHTTPS() {
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        appendNotification("Error: This app must be served over HTTPS to access the camera (except on localhost). Please ensure the URL starts with https://", "red");
        return false;
    }
    return true;
}

// Check browser support for getUserMedia
function checkGetUserMediaSupport() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        appendNotification("Error: Camera access not supported by this browser.", "red");
        return false;
    }
    return true;
}

function appendNotification(message, color = 'black') {
    const notificationElement = document.createElement('p');
    notificationElement.style.color = color;
    notificationElement.textContent = message;
    notifications.appendChild(notificationElement);
    notifications.scrollTop = notifications.scrollHeight;
    // console.log(`UI NOTIFICATION (${color}): ${message}`);
}

// Initialize Dynamsoft Barcode Reader
async function initializeDynamsoft() {
    console.log("Attempting Dynamsoft initialization....");
    try {
        if (!Dynamsoft || !Dynamsoft.DBR) {
            throw new Error("Dynamsoft SDK not loaded. Check if dbr.js is accessible.");
        }
        Dynamsoft.DBR.BarcodeReader.license = 'DLS2eyJoYW5kc2hha2VDb2RlIjoiMTA0MDEwMTA3LVRYbFhaV0pRY205cSIsIm1haW5TZXJ2ZXJVUkwiOiJodHRwczovL21kbHMuZHluYW1zb2Z0b25saW5lLmNvbSIsIm9yZ2FuaXphdGlvbklEIjoiMTA0MDEwMTA3Iiwic3RhbmRieVNlcnZlclVSTCI6Imh0dHBzOi8vc2Rscy5keW5hbXNvZnRvbmxpbmUuY29tIiwiY2hlY2tDb2RlIjozOTEyNzM1NDh9';
        await Dynamsoft.DBR.BarcodeReader.loadWasm();
        barcodeReaderInstance = await Dynamsoft.DBR.BarcodeReader.createInstance();
        //appendNotification("Dynamsoft: BarcodeReader instance created.", "grey");

        //appendNotification("Dynamsoft: Getting current runtime settings...", "grey");
        let currentSettings = await barcodeReaderInstance.getRuntimeSettings();
        //appendNotification("Dynamsoft: Current settings fetched. Modifying...", "grey");

        currentSettings.barcodeFormatIds = Dynamsoft.DBR.EnumBarcodeFormat.BF_DATAMATRIX | Dynamsoft.DBR.EnumBarcodeFormat.BF_EAN_13;
        currentSettings.expectedBarcodesCount = 0;

        //appendNotification("Dynamsoft: Applying updated settings...", "grey");
        await barcodeReaderInstance.updateRuntimeSettings(currentSettings);

        dynamsoftInitialized = true;
        appendNotification("Dynamsoft: Initialized SUCCESSFULLY (with custom settings applied correctly).", "blue");

    } catch (error) {
        console.error("Error initializing Dynamsoft:", error);
        let errMsg = `Error initializing Dynamsoft: ${error.message}`;
        if (error.code) errMsg += ` (Code: ${error.code})`;
        appendNotification(errMsg, "red");
        dynamsoftInitialized = false;
    }
    console.log("initializeDynamsoft complete. dynamsoftInitialized is:", dynamsoftInitialized);
}

// Fetch inventory data on page load
async function fetchInventoryData() {
    if (!SCRIPT_URL) {
        appendNotification("Apps Script URL not configured. Inventory features disabled.", "orange");
        inventoryData = []; // Ensure it's empty if no fetch
        return;
    }
    try {
        const response = await fetch(`${SCRIPT_URL}?action=getInventoryData`);        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        inventoryData = await response.json();
        //console.log("Inventory Data:", inventoryData);
        appendNotification(`Inventory data loaded successfully (${inventoryData.length} items)`, "blue");
    } catch (error) {
        console.error("Error fetching inventory data:", error);
        appendNotification(`Error fetching inventory data: ${error.message}`, "red");
        inventoryData = []; // Ensure it's empty on error
    }
}

// Helper function to append notifications
function appendNotification(message, color = 'black') { 
    const notificationElement = document.createElement('p');
    notificationElement.style.color = color;
    notificationElement.textContent = message;
    notifications.appendChild(notificationElement);
    notifications.scrollTop = notifications.scrollHeight;
    console.log(`UI NOTIFICATION (${color}): ${message}`);
}

// Initialize the camera
async function initializeCamera()  {
    if (!checkGetUserMediaSupport()) return;
    if (stream) stopCamera();
    appendNotification("Requesting camera access... Please grant permissions.", "blue");
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });
        video.srcObject = stream;
        video.addEventListener('loadedmetadata', () => {
            video.play().then(() => {
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                }
                appendNotification("Camera ready.", "blue");
                if (isScanning) analyzeFrame();
            }).catch(err => {
                console.error("Error playing video:", err);
                appendNotification(`Error playing video: ${err.message}`, "red");
                stopScanningCleanup();
            });
        });
    } catch (err) {
        console.error("Error accessing camera:", err);
        let userMessage = `Error accessing camera: ${err.message}`;
        if (err.name === "NotAllowedError") userMessage = "Camera access denied. Grant permissions and try again.";
        else if (err.name === "NotFoundError") userMessage = "No camera found.";
        else if (err.name === "OverconstrainedError") { /* ... your fallback ... */ }
        appendNotification(userMessage, "red");
        if (isScanning) stopScanningCleanup();
    }
}

// Stop the camera
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        // console.log("Camera tracks stopped.");
    }
    video.srcObject = null;
    stream = null;
}

// Stop scanning and cleanup
function stopScanningCleanup() {
    isScanning = false;
    document.getElementById('start-scanning').disabled = false;
    document.getElementById('stop-scanning').disabled = true;
    stopCamera();
    appendNotification("Scanning stopped.", "blue");
    if(textOverlay) textOverlay.innerHTML = '';
}

// Decode barcodes using Dynamsoft
async function decodeBarcodeWithDynamsoft(imageDataURL) {
    // console.log("decodeBarcodeWithDynamsoft: Function called."); // Can be noisy
    if (!dynamsoftInitialized || !barcodeReaderInstance){ 
        return [];
    }
    let divsToDraw = [];
    try {
        const results = await barcodeReaderInstance.decode(imageDataURL);
        //if (results.length === 0) {
           // console.log("decodeBarcodeWithDynamsoft: Dynamsoft.decode() returned 0 results for this frame.");
        //}
        for (const result of results) {
            try {
                const barcodeValue = result.barcodeText;
                const barcodeFormat = result.barcodeFormatString;
                const loc = result.localizationResult;
                
                if (!loc) {
                    console.warn("No localizationResult for barcode:", result);
                    continue; // Skip this result if no location data
                }

                const scaleX = (video.clientWidth && canvas.width && canvas.width > 0) ? video.clientWidth / canvas.width : 1;
                const scaleY = (video.clientHeight && canvas.height && canvas.height > 0) ? video.clientHeight / canvas.height : 1;

                // --- NEW: Real-time check for Reported Status ---
                let isReported = false;
                let itemFoundInInventory = false;
                // Ensure inventoryData is loaded and is an array
                if (Array.isArray(inventoryData) && inventoryData.length > 0) {
                    const inventoryItem = inventoryData.find(item => item.ItemID === barcodeValue);
                    if (inventoryItem) {
                        itemFoundInInventory = true;
                        // Check the 'Reported' property (case-insensitive for "yes")
                        if (inventoryItem.Reported && inventoryItem.Reported.toString().toLowerCase() === "yes") {
                            isReported = true;
                        }
                    }
                }

                if (!detectedBarcodes.includes(barcodeValue)) {
                    detectedBarcodes.push(barcodeValue);
                    let notificationColor = isReported ? "green" : (itemFoundInInventory ? "darkorange" : "red");
                    appendNotification(`Barcode: ${barcodeValue} (${barcodeFormat})`, notificationColor);
                }

            let cornerPoints = [];
            if (loc.points && loc.points.length === 4){
                cornerPoints = loc.points;
              } else if(loc.x1 !== undefined && loc.y1 !== undefined &&
                       loc.x2 !== undefined && loc.y2 !== undefined &&
                       loc.x3 !== undefined && loc.y3 !== undefined &&
                       loc.x4 !== undefined && loc.y4 !== undefined) {
                cornerPoints = [
                    { x: loc.x1, y: loc.y1 }, { x: loc.x2, y: loc.y2 },
                    { x: loc.x3, y: loc.y3 }, { x: loc.x4, y: loc.y4 }
                ];
            } else {
                //console.error("Barcode localization points (x1-y4 or points array) not found in result:", loc);
                continue;
            }

            const scaledPoints = cornerPoints.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
            const minX = Math.min(...scaledPoints.map(p => p.x));
            const minY = Math.min(...scaledPoints.map(p => p.y));
            const boxWidth = Math.max(...scaledPoints.map(p => p.x)) - minX;
            const boxHeight = Math.max(...scaledPoints.map(p => p.y)) - minY;

            // console.log(`Drawing BARCODE box for '${barcodeValue}': L=${minX.toFixed(0)}, T=${minY.toFixed(0)}, W=${boxWidth.toFixed(0)}, H=${boxHeight.toFixed(0)}`);
            if (boxWidth > 0 && boxHeight > 0) {
                const barcodeRegionDiv = document.createElement('div');
                    barcodeRegionDiv.className = 'barcode-region'; // Styled in CSS
                    barcodeRegionDiv.dataset.barcode = barcodeValue;
                    barcodeRegionDiv.style.borderColor = isReported ? 'limegreen' : 'red';
                    barcodeRegionDiv.style.backgroundColor = isReported ? 'rgba(50,205,50,0.2)' : 'rgba(255,0,0,0.2)';
                    barcodeRegionDiv.style.left = `${minX}px`;
                    barcodeRegionDiv.style.top = `${minY}px`;
                    barcodeRegionDiv.style.width = `${boxWidth}px`;
                    barcodeRegionDiv.style.height = `${boxHeight}px`;
                    barcodeRegionDiv.textContent = barcodeValue.substring(0, 15);
                    divsToDraw.push(barcodeRegionDiv);
                    }
            } catch (loopError) {
                console.error("Error processing one barcode result in decodeBarcodeWithDynamsoft:", loopError, result);
            }
        }
    } catch (error) {
        console.error("Error in decodeBarcodeWithDynamsoft:", error);
        //appendNotification(`Error decoding barcode: ${error.message}`, "red");
    }
    return divsToDraw
}

// === Function to process Vision API response (includes object and text handling) ===
function processVisionApiResponse(response) {
    const objectConfidenceThreshold = 0.30;
    const ocrOutputElement = document.getElementById('ocr-output');
    let currentFrameTextStrings = [];

    // Object Localization
    if (response.localizedObjectAnnotations) {
        response.localizedObjectAnnotations.forEach(obj => {
            if (obj.score >= objectConfidenceThreshold) {
                const objectName = obj.name;
                const objectColor = getObjectColor(objectName);
                const vertices = obj.boundingPoly.normalizedVertices;
                console.log(`Vision API Detected Object: ${objectName}, Score: ${obj.score.toFixed(2)}`); // Log to console
            }
        });
    }

    // Text Detection / OCR
    if (response.fullTextAnnotation && response.fullTextAnnotation.text) {
        // console.log("processVisionApiResponse: Found fullTextAnnotation for OCR output.");
        if (ocrOutputElement) {
            ocrOutputElement.textContent = response.fullTextAnnotation.text;
        }
        // Extract individual words/phrases for the detectedText global array
        if (response.fullTextAnnotation.pages) {
            response.fullTextAnnotation.pages.forEach(page => {
                if (page.blocks) {
                    page.blocks.forEach(block => {
                        if (block.paragraphs) {
                            block.paragraphs.forEach(paragraph => {
                                if (paragraph.words) {
                                    paragraph.words.forEach(word => {
                                        let wordText = "";
                                        if (word.symbols) {
                                            wordText = word.symbols.map(s => s.text).join('');
                                        }
                                        currentFrameTextStrings.push(wordText.trim());
                                        // NO CREATION OF textRegionDiv or textLabelDiv for overlay here
                                    });
                                }
                            });
                        }
                    });
                }
            });
        }
} else if (response.textAnnotations && response.textAnnotations.length > 0) {
        if (ocrOutputElement) {
             ocrOutputElement.textContent = response.textAnnotations[0].description;
        }
        for (let i = 0; i < response.textAnnotations.length; i++) {
            currentFrameTextStrings.push(response.textAnnotations[i].description.trim());
         }
    } else {
        if (ocrOutputElement) {
            ocrOutputElement.textContent = "No text detected in this frame.";
        }
    }

    if (currentFrameTextStrings.length > 0) {
        detectedText = currentFrameTextStrings; // Update the global array
    }

    // Example: Verification logic (can be moved to a separate function or UI interaction)
    const medicineNameToVerify = "paracetamol 500mg"; // Example
    const fullDetectedTextStringFromGlobal = detectedText.join(' ').toLowerCase(); // Use the global array
    if (fullDetectedTextStringFromGlobal.includes(medicineNameToVerify.toLowerCase())) {
        appendNotification(`VERIFIED (OCR Text): Found "${medicineNameToVerify}"`, 'darkgreen');
    }

    return [];
}


// Analyze the current video frame
async function analyzeFrame() {
    if (!isScanning || !video.srcObject || video.paused || video.ended || video.readyState < video.HAVE_ENOUGH_DATA) {
        if (isScanning){
            setTimeout(() => { requestAnimationFrame(analyzeFrame); }, 16);        }
        return;
    }

    textOverlay.innerHTML = '';

    if (!(video.videoWidth > 0 && video.videoHeight > 0)) {
        if (isScanning) setTimeout(() => { requestAnimationFrame(analyzeFrame); }, 16);
        return;
    }
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageDataURL = canvas.toDataURL('image/jpeg', 0.8);
    const imageDataBase64 = imageDataURL.split(',')[1];

    let detectionPromises = [];
    if (dynamsoftInitialized) {
        detectionPromises.push(decodeBarcodeWithDynamsoft(imageDataURL));
    }

    if (apiKey) { // Assuming real key
        const visionApiPromise = fetch(
            `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
            {   method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requests: [{
                        image: { content: imageDataBase64 },
                        features: [
                            { type: 'OBJECT_LOCALIZATION', maxResults: 10 },
                            { type: 'DOCUMENT_TEXT_DETECTION' }
                        ]
                    }]
                })
            }
        )
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => { // Try to get error text
                    const errorData = JSON.parse(text || "{}").error || { message: "Unknown Vision API error" };
                    console.error(`Vision API HTTP Error (${response.status}): ${errorData.message}`);
                    appendNotification(`Vision API HTTP Error (${response.status}): ${errorData.message}`, "red");
                    return []; // Return empty array on HTTP error
                });
            }
            return response.json();
        })
        .then(visionData => {
            if (visionData.responses && visionData.responses[0]) {
                return processVisionApiResponse(visionData.responses[0]); // This returns an array of divs
            } else if (visionData.error) {
                appendNotification(`Vision API Data Error: ${visionData.error.message}`, "red");
            }
            return []; // Return empty array if no valid response or data error
        })
        .catch(error => {
            console.error("Exception DURING Vision API call/processing:", error);
            appendNotification(`Vision API Call/Processing Exception: ${error.message}`, "red");
            return []; // Return empty array on exception
        });
        detectionPromises.push(visionApiPromise);
    }

    // --- Wait for ALL detection tasks to complete ---
    try {
        const resultsFromAllDetections = await Promise.all(detectionPromises);
        // resultsFromAllDetections will be an array of arrays, e.g., [[barcodeDivs], [visionDivs]]

        let allDivsToDrawThisFrame = [];
        resultsFromAllDetections.forEach(arrayOfDivs => {
            if (Array.isArray(arrayOfDivs)) {
                allDivsToDrawThisFrame.push(...arrayOfDivs);
            }
        });

        // --- Draw All Collected Bounding Boxes AT ONCE ---
        allDivsToDrawThisFrame.forEach(divElement => {
            if (divElement instanceof Node) {
                textOverlay.appendChild(divElement);
            } else {
                console.error("Skipping appendChild: Parameter is not a Node.", divElement, "Source array:", allDivsToDrawThisFrame);
            }
        });

    } catch (error) {
        console.error("Error in Promise.all or drawing collected divs:", error);
        // Handle errors from Promise.all if any of the promises reject
        // (though our individual catches should turn them into resolved promises with empty arrays)
    }

    // --- Schedule the Next Frame Analysis ---
    if (isScanning) {
        setTimeout(() => {
        requestAnimationFrame(analyzeFrame);
    },30);
}
}
// Start scanning
document.getElementById('start-scanning').addEventListener('click', async () => {
    if (!checkHTTPS()) return;
    if (isScanning) return;
    isScanning = true;
    document.getElementById('start-scanning').disabled = true;
    document.getElementById('stop-scanning').disabled = false;
    appendNotification("Scanning started...", "blue");
    detectedBarcodes = [];
    detectedText = []; // Reset detected text
    const ocrOutputElement = document.getElementById('ocr-output');
    if(ocrOutputElement) ocrOutputElement.textContent = "No text detected yet."; // Reset prescription area

    await initializeCamera();
});

function setupEventListeners() {
    console.log("Attempting to attach event listeners to buttons...");

    const startButton = document.getElementById('start-scanning');
    if (startButton) {
        startButton.addEventListener('click', async () => {
            console.log("'Start Scanning' button CLICKED!");
            if (!checkHTTPS() || isScanning) return;
            isScanning = true;
            startButton.disabled = true;
            document.getElementById('stop-scanning').disabled = false;
            appendNotification("Scanning started...", "blue");
            detectedBarcodes = [];
            detectedText = [];
            const ocrOutputElement = document.getElementById('ocr-output');
            if(ocrOutputElement) ocrOutputElement.textContent = "No text detected yet.";
            await initializeCamera(); // This will start analyzeFrame if successful
        });
        console.log("Event listener attached to 'start-scanning'.");
    } else {
        console.error("Button 'start-scanning' not found!");
    }

    const stopButton = document.getElementById('stop-scanning');
    if (stopButton) {
        stopButton.addEventListener('click', () => {
            console.log("'Stop Scanning' button CLICKED!");
            if (!isScanning) return;
            stopScanningCleanup();
        });
        console.log("Event listener attached to 'stop-scanning'.");
    } else {
        console.error("Button 'stop-scanning' not found!");
    }

    const sendButton = document.getElementById('send-to-sheets');
    if (sendButton) {
        sendButton.addEventListener('click', async () => {
            console.log("'Send to Google Sheets' button CLICKED!");

            const invoiceInputElement = document.getElementById('invoice-id-input');
            console.log("Trying to find #invoice-id-input element (for Send):", invoiceInputElement);

            if (!invoiceInputElement) {
                appendNotification("CRITICAL ERROR: HTML element with ID 'invoice-id-input' NOT FOUND!", "red");
                return;
            }
            const invoiceID = invoiceInputElement.value.trim();
            console.log("Invoice ID for Send:", invoiceID);

            if (detectedBarcodes.length === 0) {
                appendNotification("No barcodes detected to send.", "orange"); return;
            }
            if (!invoiceID) {
                appendNotification("Please enter an Invoice ID.", "orange"); return;
            }
            if (!SCRIPT_URL) {
                 appendNotification("Apps Script URL not configured for sending.", "red"); return;
            }

            appendNotification(`Sending ${detectedBarcodes.length} barcodes for Invoice ${invoiceID}...`, "blue");
            try {
                const response = await fetch(SCRIPT_URL, {
                    method: 'POST',
                    // mode: 'no-cors', // Uncomment if strict CORS issues, but then can't read response
                    //headers: { 'Content-Type': 'application/json' }, // Important for Apps Script to parse e.postData.contents
                    body: JSON.stringify({
                        action: "saveBarcodes",
                        barcodes: detectedBarcodes,
                        invoiceID: invoiceID
                    })
                });
                const resultText = await response.text();
                if (resultText === "Success") {
                    appendNotification(`Barcodes for Invoice ${invoiceID} sent.`, "blue");
                    // detectedBarcodes = []; // Optionally clear
                } else {
                    appendNotification(`Error sending barcodes: ${resultText}`, "red");
                }
            } catch (error) {
                console.error("Error in 'Send to Google Sheets' fetch:", error);
                appendNotification(`Network Error (Send to Sheets): ${error.message}`, "red");
            }
        });
        console.log("Event listener attached to 'send-to-sheets'.");
    } else {
        console.error("Button 'send-to-sheets' not found!");
    }

    const verifyButton = document.getElementById('verify-items');
    if (verifyButton) {
        verifyButton.addEventListener('click', async () => {
            console.log("'Verify Items' button CLICKED!");

            const invoiceInputElement = document.getElementById('invoice-id-input');
            console.log("Trying to find #invoice-id-input element (for Verify):", invoiceInputElement);

            if (!invoiceInputElement) {
                appendNotification("CRITICAL ERROR: HTML element with ID 'invoice-id-input' NOT FOUND!", "red");
                return;
            }
            const invoiceID = invoiceInputElement.value.trim();
            console.log("Invoice ID for Verify:", invoiceID);

            if (!invoiceID) {
                appendNotification("Please enter an Invoice ID to verify.", "orange"); return;
            }
            if (!SCRIPT_URL) {
                 appendNotification("Apps Script URL not configured for verification.", "red"); return;
            }

            appendNotification(`Verifying items for Invoice ${invoiceID}...`, "blue");
            try {
                const response = await fetch(SCRIPT_URL, {
                    method: 'POST',
                    //headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: "verifyItems",
                        invoiceID: invoiceID
                    })
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Verification request failed (${response.status}): ${errorText}`);
                }
                const resultData = await response.json();
                lastVerificationResult = resultData;
                appendNotification(resultData.message, "blue");

                if (resultData.nonReportedItems && resultData.nonReportedItems.length > 0) {
                    appendNotification(`Non-Reported/Not Found: ${resultData.nonReportedItems.join(", ")}`, "orange");
                } else {
                    appendNotification("All scanned items for this invoice are reported or found.", "green");
                }
                highlightNonReportedItems(resultData.nonReportedItems || []); // Pass empty array if undefined
            } catch (error) {
                console.error("Error in 'Verify Items' fetch:", error);
                appendNotification(`Error verifying items: ${error.message}`, "red");
            }
        });
        console.log("Event listener attached to 'verify-items'.");
    } else {
        console.error("Button 'verify-items' not found!");
    }
}

function highlightNonReportedItems(nonReportedBarcodes) {
    const overlayBarcodeDivs = Array.from(textOverlay.getElementsByClassName('barcode-region'));
    overlayBarcodeDivs.forEach(div => {
        const barcodeValue = div.dataset.barcode;
        if (barcodeValue) {
            const isNonReported = nonReportedBarcodes.some(nrItem =>
                barcodeValue === nrItem || (typeof nrItem === 'string' && nrItem.startsWith(barcodeValue + " ("))
            );
            if (isNonReported) {
                div.style.borderColor = 'red';
                div.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
            } else {
                div.style.borderColor = 'limegreen'; // Default barcode color
                div.style.backgroundColor = 'rgba(50, 205, 50, 0.2)';
            }
        }
    });
}
async function main() {
    if (checkHTTPS()) {
        setupEventListeners(); // Call this to attach listeners
        await fetchInventoryData();
        await initializeDynamsoft();
        const ocrOutputElement = document.getElementById('ocr-output');
        if(ocrOutputElement) ocrOutputElement.textContent = "No text detected yet.";
        appendNotification("App initialized. Click 'Start Scanning' to begin.", "blue");
    } else {
        appendNotification("Initialization aborted.", "red");
    }
}

main();
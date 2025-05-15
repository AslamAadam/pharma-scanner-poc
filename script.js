// Global variables
const video = document.getElementById('camera');
const canvas = document.getElementById('snapshot');
const notifications = document.getElementById('notifications');
const textOverlay = document.getElementById('text-overlay');
const apiKey = 'AIzaSyA2fsyqxjPdaeD-0p5AwD_7yoDyXpYVxIQ'; // <<<< IMPORTANT: REPLACE THIS!!!!
let detectedBarcodes = [];
let detectedText = []; // Will be populated by Vision API text detection
let inventoryData = [];
let isScanning = false;
let stream = null;
let dynamsoftInitialized = false;
let barcodeReaderInstance = null;

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
        appendNotification("Error: This browser does not support camera access (navigator.mediaDevices.getUserMedia is unavailable). Try a modern browser like Chrome or Safari.", "red");
        return false;
    }
    return true;
}

// Initialize Dynamsoft Barcode Reader
async function initializeDynamsoft() {
    console.log("Attempting Dynamsoft initialization with NEW recommended settings update method...");
    try {
        if (!Dynamsoft || !Dynamsoft.DBR) {
            throw new Error("Dynamsoft SDK not loaded. Check if dbr.js is accessible.");
        }
        Dynamsoft.DBR.BarcodeReader.license = 'DLS2eyJoYW5kc2hha2VDb2RlIjoiMTA0MDEwMTA3LVRYbFhaV0pRY205cSIsIm1haW5TZXJ2ZXJVUkwiOiJodHRwczovL21kbHMuZHluYW1zb2Z0b25saW5lLmNvbSIsIm9yZ2FuaXphdGlvbklEIjoiMTA0MDEwMTA3Iiwic3RhbmRieVNlcnZlclVSTCI6Imh0dHBzOi8vc2Rscy5keW5hbXNvZnRvbmxpbmUuY29tIiwiY2hlY2tDb2RlIjozOTEyNzM1NDh9';
        await Dynamsoft.DBR.BarcodeReader.loadWasm();
        barcodeReaderInstance = await Dynamsoft.DBR.BarcodeReader.createInstance();
        appendNotification("Dynamsoft: BarcodeReader instance created.", "grey");

        appendNotification("Dynamsoft: Getting current runtime settings...", "grey");
        let currentSettings = await barcodeReaderInstance.getRuntimeSettings();
        appendNotification("Dynamsoft: Current settings fetched. Modifying...", "grey");

        currentSettings.barcodeFormatIds = Dynamsoft.DBR.EnumBarcodeFormat.BF_DATAMATRIX | Dynamsoft.DBR.EnumBarcodeFormat.BF_EAN_13;
        currentSettings.expectedBarcodesCount = 0;

        appendNotification("Dynamsoft: Applying updated settings...", "grey");
        await barcodeReaderInstance.updateRuntimeSettings(currentSettings);

        dynamsoftInitialized = true;
        appendNotification("Dynamsoft: Initialized SUCCESSFULLY (with custom settings applied correctly).", "blue");

    } catch (error) {
        console.error("Error initializing Dynamsoft (with new settings method):", error);
        let errMsg = `Error initializing Dynamsoft: ${error.message}`;
        if (error.code) errMsg += ` (Code: ${error.code})`;
        appendNotification(errMsg, "red");
        dynamsoftInitialized = false;
    }
    console.log("initializeDynamsoft complete. dynamsoftInitialized is:", dynamsoftInitialized);
}

// Fetch inventory data on page load
async function fetchInventoryData() {
    try {
        const response = await fetch('https://script.google.com/macros/s/AKfycby_7yH-CqjEiRda7NyDJs1_eeD6duZ3y_lRT9T9_ZTzWxkvdCHoNcFhPXYDO9s40f1Ucg/exec?action=getInventoryData');
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        inventoryData = await response.json();
        // console.log("Inventory Data:", inventoryData);
        appendNotification("Inventory data loaded successfully.", "blue");
    } catch (error) {
        console.error("Error fetching inventory data:", error);
        appendNotification(`Error fetching inventory data: ${error.message}`, "red");
    }
}

// Helper function to append notifications
function appendNotification(message, color = 'black') { // Added default color
    // console.log(`Notification (${color}): ${message}`); // Console logging is often redundant with appendNotification
    const notificationElement = document.createElement('p');
    notificationElement.style.color = color;
    notificationElement.textContent = message;
    notifications.appendChild(notificationElement);
    notifications.scrollTop = notifications.scrollHeight;
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
                appendNotification("Camera ready. Scanning will start if active.", "blue");
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
            const barcodeValue = result.barcodeText;
            const barcodeFormat = result.barcodeFormatString;
            const loc = result.localizationResult;
            const scaleX = (video.clientWidth && canvas.width && canvas.width > 0) ? video.clientWidth / canvas.width : 1;
            const scaleY = (video.clientHeight && canvas.height && canvas.height > 0) ? video.clientHeight / canvas.height : 1;

            if (!detectedBarcodes.includes(barcodeValue)) {
                detectedBarcodes.push(barcodeValue);
                appendNotification(`Barcode: ${barcodeValue} (${result.barcodeFormatString})`, "green");
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
                console.error("Barcode localization points (x1-y4 or points array) not found in result:", loc);
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
                barcodeRegionDiv.className = 'barcode-region';
                barcodeRegionDiv.style.left = `${minX}px`;
                barcodeRegionDiv.style.top = `${minY}px`;
                barcodeRegionDiv.style.width = `${boxWidth}px`;
                barcodeRegionDiv.style.height = `${boxHeight}px`;
                barcodeRegionDiv.textContent = barcodeValue.substring(0, 20);
                divsToDraw.push(barcodeRegionDiv);
            }
        }
    } catch (error) {
        console.error("Error in decodeBarcodeWithDynamsoft:", error);
        appendNotification(`Error decoding barcode: ${error.message}`, "red");
    }
    return divsToDraw
}

// === Function to process Vision API response (includes object and text handling) ===
function processVisionApiResponse(response) {
    let divsToDraw = [];
    const objectConfidenceThreshold = 0.30;

    // Object Localization
    if (response.localizedObjectAnnotations) {
        response.localizedObjectAnnotations.forEach(obj => {
            if (obj.score >= objectConfidenceThreshold) {
                const objectName = obj.name;
                const objectColor = getObjectColor(objectName);
                const vertices = obj.boundingPoly.normalizedVertices;

                if (vertices && vertices.length === 4) {
                    const scaledPoints = vertices.map(v => ({ x: (v.x || 0) * video.clientWidth, y: (v.y || 0) * video.clientHeight }));
                    const minX = Math.min(...scaledPoints.map(p => p.x));
                    const minY = Math.min(...scaledPoints.map(p => p.y));
                    const boxWidth = Math.max(...scaledPoints.map(p => p.x)) - minX;
                    const boxHeight = Math.max(...scaledPoints.map(p => p.y)) - minY;

                    if (boxWidth > 0 && boxHeight > 0) {
                        const objectRegionDiv = document.createElement('div');
                        objectRegionDiv.className = 'detected-object-region';
                        objectRegionDiv.style.borderColor = objectColor;
                        objectRegionDiv.style.left = `${minX}px`;
                        objectRegionDiv.style.top = `${minY}px`;
                        objectRegionDiv.style.width = `${boxWidth}px`;
                        objectRegionDiv.style.height = `${boxHeight}px`;

                        const labelDiv = document.createElement('div');
                        labelDiv.className = 'object-label';
                        labelDiv.textContent = `${objectName} ${obj.score.toFixed(1)}`;
                        labelDiv.style.backgroundColor = objectColor;
                        objectRegionDiv.appendChild(labelDiv);
                        divsToDraw.push(objectRegionDiv);
                    }
                }
            }
        });
    }

    // Text Detection / OCR
    const ocrOutputElement = document.getElementById('ocr-output'); // For prescription display
    let currentFrameDetectedText = [];

    if (response.fullTextAnnotation) {
        if (ocrOutputElement){
            ocrOutputElement.textContent = response.fullTextAnnotation.text;
        }
        response.fullTextAnnotation.pages.forEach(page => {
            page.blocks.forEach(block => {
                block.paragraphs.forEach(paragraph => {
                    paragraph.words.forEach(word => {
                        let wordText = word.symbols.map(s => s.text).join('');
                        currentFrameDetectedText.push(wordText.trim());
                        const vertices = word.boundingBox.vertices;

                        if (vertices && vertices.length === 4) {
                            const scaleX = (video.clientWidth && canvas.width && canvas.width > 0) ? video.clientWidth / canvas.width : 1;
                            const scaleY = (video.clientHeight && canvas.height && canvas.height > 0) ? video.clientHeight / canvas.height : 1;
                            const scaledPoints = vertices.map(v => ({ x: (v.x || 0) * scaleX, y: (v.y || 0) * scaleY }));
                            const minX = Math.min(...scaledPoints.map(p => p.x));
                            const minY = Math.min(...scaledPoints.map(p => p.y));
                            const boxWidth = Math.max(...scaledPoints.map(p => p.x)) - minX;
                            const boxHeight = Math.max(...scaledPoints.map(p => p.y)) - minY;

                            if (boxWidth > 0 && boxHeight > 0) {
                                const textRegionDiv = document.createElement('div');
                                textRegionDiv.className = 'detected-text-region';
                                textRegionDiv.style.left = `${minX}px`;
                                textRegionDiv.style.top = `${minY}px`;
                                textRegionDiv.style.width = `${boxWidth}px`;
                                textRegionDiv.style.height = `${boxHeight}px`;
                                const textLabelDiv = document.createElement('div');
                                textLabelDiv.className = 'text-label'; // Use the same label style for consistency
                                textLabelDiv.textContent = wordText;
                                textRegionDiv.appendChild(textLabelDiv);
                                divsToDraw.push(textRegionDiv);
                            }
                        }
                    });
                });
            });
        });
} else if (response.textAnnotations && response.textAnnotations.length > 0) {
        if (ocrOutputElement) {
             ocrOutputElement.textContent = response.textAnnotations[0].description;
        }
        for (let i = 1; i < response.textAnnotations.length; i++) {
            const textAnnotation = response.textAnnotations[i];
            const text = textAnnotation.description;
            currentFrameDetectedText.push(text.trim());
         }
    } else {
        if (ocrOutputElement) {
            ocrOutputElement.textContent = "No text detected in this frame.";
        }
    }

    if (currentFrameDetectedText.length > 0) {
        detectedText = currentFrameDetectedText; // Update the global array
    }

    // Example: Verification logic (can be moved to a separate function or UI interaction)
    const medicineNameToVerify = "paracetamol 500mg"; // Example
    const fullDetectedTextString = detectedText.join(' ').toLowerCase();
    if (fullDetectedTextString.includes(medicineNameToVerify.toLowerCase())) {
        appendNotification(`VERIFIED (Text): Found "${medicineNameToVerify}"`, 'darkgreen');
    }

return divsToDraw;
}


// Analyze the current video frame
async function analyzeFrame() {
    if (!isScanning || !video.srcObject || video.paused || video.ended || video.readyState < video.HAVE_ENOUGH_DATA) {
        if (isScanning){
            requestAnimationFrame(analyzeFrame);
        }
        return;
    }

    textOverlay.innerHTML = '';

    if (!(video.videoWidth > 0 && video.videoHeight > 0)) {
        if (isScanning) requestAnimationFrame(analyzeFrame);
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
        requestAnimationFrame(analyzeFrame);
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

// Stop scanning
document.getElementById('stop-scanning').addEventListener('click', () => {
    if (!isScanning) return;
    stopScanningCleanup();
});

// Send barcodes to Google Sheets
document.getElementById('send-to-sheets').addEventListener('click', async () => { /* ... your existing code ... */ });

// Verify items
document.getElementById('verify-items').addEventListener('click', async () => { /* ... your existing code ... */ });

// Initialize the app
async function main() {
    if (checkHTTPS()) {
        await fetchInventoryData();
        await initializeDynamsoft();
        const ocrOutputElement = document.getElementById('ocr-output'); // Initialize prescription area
        if(ocrOutputElement) ocrOutputElement.textContent = "No text detected yet.";
        appendNotification("App initialized. Click 'Start Scanning' to begin.", "blue");
    } else {
        appendNotification("Initialization aborted due to HTTPS requirement.", "red");
    }
}

main();
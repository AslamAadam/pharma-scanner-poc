// Global variables
const video = document.getElementById('camera');
const canvas = document.getElementById('snapshot');
const notifications = document.getElementById('notifications');
const textOverlay = document.getElementById('text-overlay');
const apiKey = 'AIzaSyA2fsyqxjPdaeD-0p5AwD_7yoDyXpYVxIQ'; // Replace with a valid Google Cloud Vision API key
let detectedBarcodes = [];
let detectedText = [];
let inventoryData = [];
let isScanning = false;
let stream = null;
let dynamsoftInitialized = false;

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
    try {
        if (!Dynamsoft || !Dynamsoft.DBR) {
            throw new Error("Dynamsoft SDK not loaded. Check if dbr.js is accessible.");
        }
        await Dynamsoft.DBR.BarcodeReader.loadWasm();
        Dynamsoft.DBR.BarcodeReader.license = 'DLS2eyJoYW5kc2hha2VDb2RlIjoiMTA0MDEwMTA3LVRYbFhaV0pRY205cSIsIm1haW5TZXJ2ZXJVUkwiOiJodHRwczovL21kbHMuZHluYW1zb2Z0b25saW5lLmNvbSIsIm9yZ2FuaXphdGlvbklEIjoiMTA0MDEwMTA3Iiwic3RhbmRieVNlcnZlclVSTCI6Imh0dHBzOi8vc2Rscy5keW5hbXNvZnRvbmxpbmUuY29tIiwiY2hlY2tDb2RlIjozOTEyNzM1NDh9'; // Replace with your trial license key
        dynamsoftInitialized = true;
        appendNotification("Dynamsoft Barcode Reader initialized successfully.", "blue");
    } catch (error) {
        console.error("Error initializing Dynamsoft:", error);
        appendNotification(`Error initializing Dynamsoft: ${error.message}`, "red");
        dynamsoftInitialized = false;
    }
}

// Fetch inventory data on page load
async function fetchInventoryData() {
    try {
        const response = await fetch('https://script.google.com/macros/s/AKfycby_7yH-CqjEiRda7NyDJs1_eeD6duZ3y_lRT9T9_ZTzWxkvdCHoNcFhPXYDO9s40f1Ucg/exec?action=getInventoryData', {
            method: 'GET'
        });
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        inventoryData = await response.json();
        console.log("Inventory Data:", inventoryData);
        appendNotification("Inventory data loaded successfully.", "blue");
    } catch (error) {
        console.error("Error fetching inventory data:", error);
        appendNotification(`Error fetching inventory data: ${error.message}`, "red");
    }
}

// Helper function to append notifications without overwriting
function appendNotification(message, color) {
    console.log(`Notification: ${message}`);
    const notificationElement = document.createElement('p');
    notificationElement.style.color = color;
    notificationElement.textContent = message;
    notifications.appendChild(notificationElement);
    notifications.scrollTop = notifications.scrollHeight;
}

// Initialize the camera
async function initializeCamera() {
    try {
        if (!checkGetUserMediaSupport()) {
            return;
        }

        if (stream) {
            stopCamera();
        }

        appendNotification("Requesting camera access... Please grant permissions when prompted.", "blue");

        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } 
        });

        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play().then(() => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                appendNotification("Camera initialized successfully. Position the barcode or prescription in the frame.", "blue");
            }).catch(err => {
                console.error("Error playing video:", err);
                appendNotification(`Error playing video: ${err.message}`, "red");
            });
        };
    } catch (err) {
        console.error("Error accessing camera:", err);
        if (err.name === "NotAllowedError") {
            appendNotification("Camera access denied. Please grant camera permissions in your browser settings and try again.", "red");
        } else if (err.name === "NotFoundError") {
            appendNotification("No camera found on this device. Please ensure a camera is available.", "red");
        } else if (err.name === "OverconstrainedError") {
            appendNotification("Requested camera resolution not supported. Trying default settings...", "orange");
            // Fallback to default constraints
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
                video.srcObject = stream;
                video.onloadedmetadata = () => {
                    video.play();
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    appendNotification("Camera initialized with default settings.", "blue");
                };
            } catch (fallbackErr) {
                appendNotification(`Fallback camera initialization failed: ${fallbackErr.message}`, "red");
            }
        } else {
            appendNotification(`Error accessing camera: ${err.message}`, "red");
        }
    }
}

// Stop the camera
function stopCamera() {
    if (stream) {
        stream.getTracks().forEach(track => {
            track.stop();
            console.log("Camera track stopped:", track);
        });
        video.srcObject = null;
        stream = null;
        appendNotification("Camera stopped.", "blue");
    }
}

// Decode barcodes using Dynamsoft
async function decodeBarcodeWithDynamsoft(imageDataURL) {
    if (!dynamsoftInitialized) {
        appendNotification("Dynamsoft not initialized. Please check license and initialization.", "red");
        return;
    }

    try {
        const reader = await Dynamsoft.DBR.BarcodeReader.createInstance();
        const results = await reader.decode(imageDataURL);
        let barcodeFound = false;

        for (const result of results) {
            const barcodeValue = result.barcodeText;
            const barcodeFormat = result.barcodeFormatString;

            if (!detectedBarcodes.includes(barcodeValue)) {
                detectedBarcodes.push(barcodeValue);
                appendNotification(`Barcode: ${barcodeValue}, Format: ${barcodeFormat}`, "green");

                const localization = result.localizationResult;
                const minX = localization.x1;
                const minY = localization.y1;
                const maxX = localization.x3;
                const maxY = localization.y3;
                const width = maxX - minX;
                const height = maxY - minY;

                const barcodeRegionDiv = document.createElement('div');
                barcodeRegionDiv.className = 'barcode-region';
                barcodeRegionDiv.style.left = `${minX}px`;
                barcodeRegionDiv.style.top = `${minY}px`;
                barcodeRegionDiv.style.width = `${width}px`;
                barcodeRegionDiv.style.height = `${height}px`;
                barcodeRegionDiv.textContent = barcodeValue;
                textOverlay.appendChild(barcodeRegionDiv);

                barcodeFound = true;
            }
        }

        if (!barcodeFound) {
            appendNotification("No barcodes detected by Dynamsoft in this frame. Ensure the barcode is clear and well-lit.", "black");
        }

        await reader.destroy();
    } catch (error) {
        console.error("Error decoding with Dynamsoft:", error);
        appendNotification(`Error decoding barcode with Dynamsoft: ${error.message}`, "red");
    }
}

// Analyze the current video frame
async function analyzeFrame() {
    if (!isScanning || !video.videoWidth) {
        console.log("Skipping analysis: Not scanning or video not ready.");
        appendNotification("Cannot analyze frame: Video not ready. Check camera initialization.", "red");
        return;
    }

    // Capture the current frame
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL('image/jpeg', 1.0).split(',')[1];
    const imageDataURL = canvas.toDataURL('image/jpeg', 1.0);

    // Decode barcodes with Dynamsoft
    await decodeBarcodeWithDynamsoft(imageDataURL);

    // Use Vision API for text and object detection
    try {
        const response = await fetch(
            `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requests: [
                        {
                            image: { content: imageData },
                            features: [
                                { type: 'TEXT_DETECTION' },
                                { type: 'DOCUMENT_TEXT_DETECTION' },
                                { type: 'OBJECT_LOCALIZATION', maxResults: 10 }
                            ]
                        }
                    ]
                })
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Vision API request failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log("Vision API Response:", JSON.stringify(data, null, 2));
        let resultsFound = false;

        if (data.error) {
            appendNotification(`Vision API Error: ${data.error.message}`, "red");
            resultsFound = true;
        } else if (data.responses && data.responses[0]) {
            // Text Detection (Printed and Handwritten)
            const textAnnotations = data.responses[0].fullTextAnnotation || data.responses[0].textAnnotations;
            if (textAnnotations) {
                let extractedText = [];
                if (data.responses[0].fullTextAnnotation) {
                    extractedText.push(data.responses[0].fullTextAnnotation.text);
                    appendNotification(`Detected Text (Document): ${data.responses[0].fullTextAnnotation.text}`, "black");
                } else if (data.responses[0].textAnnotations && data.responses[0].textAnnotations.length > 0) {
                    for (let i = 1; i < data.responses[0].textAnnotations.length; i++) {
                        const textAnnotation = data.responses[0].textAnnotations[i];
                        const text = textAnnotation.description;
                        const vertices = textAnnotation.boundingPoly.vertices;

                        extractedText.push(text.toLowerCase());

                        if (vertices && vertices.length === 4) {
                            const minX = Math.min(...vertices.map(v => v.x));
                            const minY = Math.min(...vertices.map(v => v.y));
                            const maxX = Math.max(...vertices.map(v => v.x));
                            const maxY = Math.max(...vertices.map(v => v.y));
                            const width = maxX - minX;
                            const height = maxY - minY;

                            const textRegionDiv = document.createElement('div');
                            textRegionDiv.className = 'text-region';
                            textRegionDiv.style.left = `${minX}px`;
                            textRegionDiv.style.top = `${minY}px`;
                            textRegionDiv.style.width = `${width}px`;
                            textRegionDiv.style.height = `${height}px`;
                            textRegionDiv.textContent = text;
                            textOverlay.appendChild(textRegionDiv);

                            appendNotification(`Detected Text: ${text}`, "black");
                        }
                    }
                }

                detectedText = extractedText;

                if (detectedBarcodes.length > 0) {
                    detectedBarcodes.forEach(barcode => {
                        const item = inventoryData.find(item => item.itemID === barcode);
                        if (item) {
                            const itemName = item.itemName.toLowerCase();
                            const batchNumber = item.batchNumber.toLowerCase();
                            const textMatch = detectedText.some(text => 
                                itemName.includes(text.toLowerCase()) || batchNumber.includes(text.toLowerCase())
                            );
                            if (textMatch) {
                                appendNotification(`Text matches inventory for ${barcode}.`, "blue");
                            } else {
                                appendNotification(`Warning: Text does not match inventory for ${barcode}.`, "orange");
                            }
                        }
                    });
                }
                resultsFound = true;
            }

            if (data.responses[0].localizedObjectAnnotations) {
                const expectedObjects = ["bottle", "box", "pill", "medicine", "container"];
                let validObjectFound = false;

                data.responses[0].localizedObjectAnnotations.forEach(obj => {
                    appendNotification(`Detected ${obj.name}.`, "black");
                    if (expectedObjects.includes(obj.name.toLowerCase())) {
                        validObjectFound = true;
                    }
                    resultsFound = true;
                });

                if (!validObjectFound) {
                    appendNotification("Warning: No medicine-related objects detected.", "orange");
                }
            }

            if (!resultsFound) {
                appendNotification("No text or objects detected in this frame. Ensure the content is clear and well-lit.", "black");
            }
        } else {
            appendNotification("Error: Invalid API response structure.", "red");
        }
    } catch (error) {
        console.error("Error analyzing image with Vision API:", error);
        appendNotification(`Error analyzing frame with Vision API: ${error.message}`, "red");
    }

    if (isScanning) {
        setTimeout(analyzeFrame, 2000);
    }
}

// Start scanning
document.getElementById('start-scanning').addEventListener('click', async () => {
    if (!checkHTTPS()) return;
    if (!isScanning) {
        isScanning = true;
        document.getElementById('start-scanning').disabled = true;
        document.getElementById('stop-scanning').disabled = false;
        appendNotification("Scanning started...", "blue");
        await initializeCamera();
        if (video.srcObject) {
            await analyzeFrame();
        } else {
            appendNotification("Camera not available. Please try again after granting permissions.", "red");
            isScanning = false;
            document.getElementById('start-scanning').disabled = false;
            document.getElementById('stop-scanning').disabled = true;
        }
    }
});

// Stop scanning
document.getElementById('stop-scanning').addEventListener('click', () => {
    if (isScanning) {
        isScanning = false;
        document.getElementById('start-scanning').disabled = false;
        document.getElementById('stop-scanning').disabled = true;
        appendNotification("Scanning stopped.", "blue");
        stopCamera();
    }
});

// Send barcodes to Google Sheets
document.getElementById('send-to-sheets').addEventListener('click', async () => {
    if (detectedBarcodes.length === 0) {
        appendNotification("No barcodes detected to send.", "orange");
        return;
    }

    try {
        const response = await fetch('https://script.google.com/macros/s/AKfycby_7yH-CqjEiRda7NyDJs1_eeD6duZ3y_lRT9T9_ZTzWxkvdCHoNcFhPXYDO9s40f1Ucg/exec?action=saveBarcodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                barcodes: detectedBarcodes,
                invoiceID: "INV001"
            })
        });

        const result = await response.text();
        if (result === "Success") {
            appendNotification(`Barcodes sent to Google Sheets: ${detectedBarcodes.join(", ")}`, "blue");
            detectedBarcodes = [];
            detectedText = [];
        } else {
            appendNotification("Error sending barcodes to Google Sheets.", "red");
        }
    } catch (error) {
        console.error("Error sending to Google Sheets:", error);
        appendNotification(`Error: ${error.message}`, "red");
    }
});

// Verify items
document.getElementById('verify-items').addEventListener('click', async () => {
    try {
        const response = await fetch('https://script.google.com/macros/s/AKfycby_7yH-CqjEiRda7NyDJs1_eeD6duZ3y_lRT9T9_ZTzWxkvdCHoNcFhPXYDO9s40f1Ucg/exec?action=verify', {
            method: 'GET'
        });
        const result = await response.text();
        appendNotification(`${result}`, "blue");
    } catch (error) {
        console.error("Error verifying items:", error);
        appendNotification(`Error: ${error.message}`, "red");
    }
});

// Initialize the app
if (checkHTTPS()) {
    fetchInventoryData();
    initializeCamera();
    initializeDynamsoft();
} else {
    appendNotification("Initialization aborted due to HTTPS requirement.", "red");
}
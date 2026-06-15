// Extract Event ID from URL
const urlParams = new URLSearchParams(window.location.search);
const eventId = urlParams.get('event_id');

// Hide .html extension from URL bar
if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && window.location.protocol !== 'file:' && window.location.pathname.endsWith('.html')) {
  const cleanPath = window.location.pathname.slice(0, -5);
  window.history.replaceState(null, '', cleanPath + window.location.search + window.location.hash);
}

// Helper to get query params
function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

let currentUpiId = null;
let currentUpiOwnerName = null;
let currentEventName = null;
let currentReceiptSessionId = null;

function showRejectionPopup(message) {
  document.getElementById('rejection-msg').innerText = message;
  const modal = document.getElementById('rejection-modal');
  modal.style.display = 'flex';
  // Restart animation
  const box = modal.querySelector('div');
  box.style.animation = 'none';
  box.offsetHeight; // trigger reflow
  box.style.animation = 'popIn 0.25s ease';
}

// Determine backend URL (works on local and prod)
const API_BASE = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.hostname.match(/^[0-9.]+$/)
  ? `http://${window.location.hostname}:8000` 
  : "API_PLACEHOLDER".replace(/\/$/, "");

document.addEventListener("DOMContentLoaded", async () => {
  if (!eventId) {
    alert("Invalid Link: No event ID provided.");
    return;
  }

  // Fetch Event Details
  try {
    const res = await fetch(`${API_BASE}/api/public/event/${eventId}`);
    if (!res.ok) {
      document.getElementById('skeleton').innerHTML = "<p style='color:red;'>Event not found or link has expired.</p>";
      return;
    }
    
    const event = await res.json();
    currentEventName = event.name;
    currentUpiId = event.upi_id;
    currentUpiOwnerName = event.upi_owner_name;

    // Populate UI
    document.getElementById('lbl-event-name').innerText = currentEventName;
    document.getElementById('lbl-organizer').innerText = event.organizer_name || "Organizer";
    document.getElementById('manual-collector').innerText = currentUpiOwnerName || "Not verified";
    
    // Show owner name below QR
    if (currentUpiOwnerName) {
      document.getElementById('lbl-upi-owner').innerHTML = 'UPI Registered Name: <strong style="color: #10b981; font-weight: 800; font-size: 15px;">' + currentUpiOwnerName + '</strong>';
      document.getElementById('lbl-upi-id').innerHTML = 'UPI ID: <strong style="color: #6b7280; font-weight: 600; font-size: 13px;">' + currentUpiId + '</strong>';
    }

    if (!currentUpiId || !currentUpiOwnerName) {
      document.getElementById('qr-box').innerHTML = "<p style='color:red;'>Organizer hasn't verified a UPI ID yet.</p>";
      document.getElementById('btn-deep-link').style.display = "none";
    } else {
      // Generate standard UPI URL
      const safeUpiId = currentUpiId.trim();
      const safeOwnerName = encodeURIComponent(currentUpiOwnerName.trim());
      const upiUrl = `upi://pay?pa=${safeUpiId}&pn=${safeOwnerName}&cu=INR&tn=Donation`;
      
      // Wire up deep-link button to native confirmation modal
      document.getElementById('btn-deep-link').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('upi-confirm-name').innerText = currentUpiOwnerName;
        document.getElementById('upi-confirm-id').innerText = 'UPI: ' + currentUpiId;
        
        const proceedBtn = document.getElementById('upi-confirm-proceed');
        proceedBtn.href = upiUrl; // Setting the href of the anchor directly allows native OS intent handling
        proceedBtn.onclick = () => {
          modal.style.display = 'none';
        };

        const modal = document.getElementById('upi-confirm-modal');
        modal.style.display = 'flex';
      });

      // Draw QR Code
      new QRCode(document.getElementById("qr-box"), {
        text: upiUrl,
        width: 200,
        height: 200,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
      });

      // Setup Download QR button
      document.getElementById('btn-download-qr').addEventListener('click', (e) => {
        e.preventDefault();
        const qrBox = document.getElementById("qr-box");
        let qrCanvas = qrBox.querySelector("canvas");
        let qrImg = qrBox.querySelector("img");
        let dataUrl = null;
        
        if (qrCanvas) {
          const PADDING = 20;
          const newCanvas = document.createElement("canvas");
          newCanvas.width = qrCanvas.width + (PADDING * 2);
          newCanvas.height = qrCanvas.height + (PADDING * 2);
          const ctx = newCanvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, newCanvas.width, newCanvas.height);
          ctx.drawImage(qrCanvas, PADDING, PADDING);
          dataUrl = newCanvas.toDataURL("image/png");
        } else if (qrImg && qrImg.src) {
          dataUrl = qrImg.src;
        }
        
        if (dataUrl) {
          const a = document.createElement("a");
          a.href = dataUrl;
          a.download = `upi-qr-${currentUpiId.split('@')[0]}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
      });
    }

    // Show Content
    document.getElementById('skeleton').style.display = 'none';
    document.getElementById('content').style.display = 'block';

  } catch (error) {
    console.error("Error fetching event:", error);
    document.getElementById('skeleton').innerHTML = "<p style='color:red;'>Connection error. Please check your internet.</p>";
  }
});

// Handle File Selection UI
const fileInput = document.getElementById('file-input');
const btnSelect = document.getElementById('btn-file-select');
const btnSubmit = document.getElementById('btn-submit');

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    btnSelect.innerHTML = `<i class="icon-check"></i> ${fileInput.files[0].name}`;
    btnSelect.style.borderColor = "var(--primary)";
    btnSelect.style.color = "var(--primary)";
    btnSubmit.style.display = "block"; // Show submit button
  }
});

// Handle Submit
btnSubmit.addEventListener('click', async () => {
  if (fileInput.files.length === 0) return;

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append("file", file);

  // Show Loader
  const loader = document.getElementById('loader');
  loader.style.display = 'flex';
  document.getElementById('loader-spinner').style.display = 'block';
  document.getElementById('loader-success').style.display = 'none';
  document.getElementById('loader-title').innerText = "Verifying Payment...";
  document.getElementById('loader-title').style.color = "#1f2937";
  document.getElementById('loader-desc').innerText = "Please wait while we verify your payment receipt and record your donation.";

  try {
    const res = await fetch(`${API_BASE}/api/public/event/${eventId}/upload_receipt`, {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    
    // Check if response indicates AI rejection (found receiver but wrong person)
    if (data.status === "rejected") {
      console.log("AI rejected receipt:", data.message);
      document.getElementById('loader').style.display = 'none';
      showRejectionPopup(data.message);
      return;
    }
    if (data.status === "unrelated_image") {
      console.log("AI: unrelated image");
      document.getElementById('loader').style.display = 'none';
      showRejectionPopup(data.message);
      return;
    }
    if (data.status === "failed") {
      console.log("AI: failed transaction");
      document.getElementById('loader').style.display = 'none';
      showRejectionPopup(data.message);
      return;
    }
    if (data.status === "extraction_failed" || data.extraction_failed === true) {
      console.log("ℹ️ AI extraction failed, showing manual entry form");
      document.getElementById('loader').style.display = 'none';
      showManualEntryForm(false, null, null, data.receipt_session_id || null);
      return;
    }
    
    // Check if response is partial success
    if (data.status === "partial_success") {
      console.log("ℹ️ AI partial success, asking for donor name");
      document.getElementById('loader').style.display = 'none';
      currentReceiptSessionId = data.receipt_session_id;
      showManualEntryForm(true, data.amount, data.receiver_name);
      return;
    }

    if (!res.ok) {
      const errorData = data;
      throw new Error(errorData.detail || "Failed to verify receipt");
    }

    const amount = data.donation.amount;
    const name = data.donation.donor_name;
    const verification = data.verification || "manual_entry";
    
    console.log("✅ Upload Response:", data);
    console.log("   Amount:", amount);
    console.log("   Donor:", name);
    console.log("   Verification:", verification);

    // Show Final Success UI immediately
    document.getElementById('content').innerHTML = `
      <i class="icon-check-circle" style="font-size: 60px; color: #10b981; margin-bottom:15px;"></i>
      <h2 style="margin: 0 0 10px 0; color: #1f2937; font-size: 24px;">Thank You!</h2>
      <p style="margin: 0 0 20px 0; color: #374151; font-size: 15px;">Your payment has been successfully recorded.</p>
      
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 15px; text-align: left; margin-bottom: 20px;">
        <div style="font-weight: 600; color: #166534; font-size: 14px; margin-bottom: 6px;">✅ Receipt Verified</div>
        <div style="color: #15803d; font-size: 13px; line-height: 1.5;">Your payment receipt has been processed and added to the event records for organizer review.</div>
      </div>
      
      <p style="font-size: 13px; color: #6b7280; margin-top: 15px; font-weight: 500;">
        Collected by: ${currentUpiOwnerName || "Organizer"}
      </p>
      <p style="font-size: 12px; color: #9ca3af; margin-top: 10px;">You may now close this window.</p>
    `;
    loader.style.display = 'none';

  } catch (error) {
    console.error("❌ Upload Error:", error);
    document.getElementById('loader').style.display = 'none';
    
    // Show manual entry form as fallback
    showManualEntryForm();
  }
});

// Manual Entry Form Functions
function showManualEntryForm(isPartial = false, lockedAmount = null, receiverName = null, fallbackSessionId = null) {
  document.getElementById('manual-entry-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  document.getElementById('manual-name').value = '';
  
  const verifiedMsg = document.getElementById('manual-verified-msg');
  const descMsg = document.getElementById('manual-desc-msg');
  
  const amountInput = document.getElementById('manual-amount');
  if (isPartial && lockedAmount) {
    if (verifiedMsg) verifiedMsg.style.display = 'flex';
    if (descMsg) descMsg.innerHTML = "We found the payment amount and receiver details from your receipt.<br><br>Sender name was not available in the receipt. Please enter your name to complete the payment record.";
    amountInput.value = lockedAmount;
    amountInput.disabled = true;
    amountInput.style.backgroundColor = '#f3f4f6';
    // Add a note above it (Removed partial-note as requested)
    
    if (receiverName) {
      document.getElementById('manual-collector').innerText = receiverName;
    }
    const noteText = document.getElementById('manual-note-text');
    if (noteText) {
      noteText.innerHTML = `<strong>Receipt Verified</strong><br>Your payment details have been extracted from the receipt. Enter your name and submit to complete your donation record.`;
    }
    document.getElementById('manual-collector-label').innerText = "UPI Registered Name";
    document.getElementById('manual-collector-sub').style.display = 'none';
  } else {
    if (verifiedMsg) verifiedMsg.style.display = 'none';
    if (descMsg) descMsg.innerHTML = "We couldn't extract the payment details automatically. Please enter your details below:";
    
    amountInput.value = '';
    amountInput.disabled = false;
    amountInput.style.backgroundColor = '';
    amountInput.style.color = '';
    currentReceiptSessionId = fallbackSessionId;
    const note = document.getElementById('partial-note');
    if (note) note.style.display = 'none';
    document.getElementById('manual-collector').innerText = currentUpiOwnerName || "Not verified";
    const noteText = document.getElementById('manual-note-text');
    if (noteText) {
      if (fallbackSessionId) {
        noteText.innerHTML = `<strong>Note:</strong> We couldn't extract the details automatically. Your screenshot is saved for verification. Your donation will be submitted for organizer review.`;
      } else {
        noteText.innerHTML = `<strong>Note:</strong> Your donation details will be submitted manually. The verified UPI owner will be shown as <strong>UPI Registered Name</strong>.`;
      }
    }
    document.getElementById('manual-collector-label').innerText = "UPI Registered Name";
    document.getElementById('manual-collector-sub').style.display = 'block';
  }
  
  document.getElementById('manual-name').focus();
}

document.getElementById('btn-manual-cancel').addEventListener('click', () => {
  document.getElementById('manual-entry-modal').style.display = 'none';
  document.body.style.overflow = '';
});

document.getElementById('btn-manual-submit').addEventListener('click', async () => {
  const name = document.getElementById('manual-name').value.trim();
  const amount = parseFloat(document.getElementById('manual-amount').value);

  // Clear previous errors
  document.getElementById('err-manual-name').style.display = 'none';
  document.getElementById('err-manual-amount').style.display = 'none';

  let hasError = false;
  if (!name) {
    document.getElementById('err-manual-name').innerText = 'Please enter your name.';
    document.getElementById('err-manual-name').style.display = 'block';
    hasError = true;
  }
  if (!amount || amount <= 0) {
    document.getElementById('err-manual-amount').innerText = 'Please enter a valid amount greater than 0.';
    document.getElementById('err-manual-amount').style.display = 'block';
    hasError = true;
  }
  if (hasError) return;

  // Hide modal and show loader
  document.getElementById('manual-entry-modal').style.display = 'none';
  document.body.style.overflow = '';
  const loader = document.getElementById('loader');
  loader.style.display = 'flex';
  document.getElementById('loader-spinner').style.display = 'block';
  document.getElementById('loader-success').style.display = 'none';
  document.getElementById('loader-title').innerText = "Recording Donation...";
  document.getElementById('loader-title').style.color = "#1f2937";
  document.getElementById('loader-desc').innerText = "Please wait while we record your donation.";

  try {
    const res = await fetch(`${API_BASE}/api/public/event/${eventId}/submit_manual_donation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        donor_name: name,
        amount: amount,
        receipt_session_id: currentReceiptSessionId
      })
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.detail || "Failed to record donation");
    }

    const data = await res.json();
    
    console.log("✅ Manual Donation Recorded:", data);

    // Show Final Success UI immediately
    document.getElementById('content').innerHTML = `
      <i class="icon-check-circle" style="font-size: 60px; color: #10b981; margin-bottom:15px;"></i>
      <h2 style="margin: 0 0 10px 0; color: #1f2937; font-size: 24px;">Thank You!</h2>
      <p style="margin: 0 0 20px 0; color: #374151; font-size: 15px;">Your payment has been successfully recorded.</p>
      
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 15px; text-align: left; margin-bottom: 20px;">
        <div style="font-weight: 600; color: #166534; font-size: 14px; margin-bottom: 6px;">✅ Receipt Verified</div>
        <div style="color: #15803d; font-size: 13px; line-height: 1.5;">Your payment receipt has been processed and added to the event records for organizer review.</div>
      </div>
      
      <p style="font-size: 13px; color: #6b7280; margin-top: 15px; font-weight: 500;">
        Collected by: ${currentUpiOwnerName || "Organizer"}
      </p>
      <p style="font-size: 12px; color: #9ca3af; margin-top: 10px;">You may now close this window.</p>
    `;
    loader.style.display = 'none';

  } catch (error) {
    console.error("Manual Entry Error:", error);
    document.getElementById('loader').style.display = 'none';
    showRejectionPopup(error.message || "Failed to record donation. Please try again.");
  }
});

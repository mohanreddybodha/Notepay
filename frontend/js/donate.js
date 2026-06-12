// Helper to get query params
function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

const eventId = getQueryParam('event_id');
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
const API_BASE = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' 
  ? 'http://127.0.0.1:8000' 
  : 'https://api.notepay.in';

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
    document.getElementById('lbl-event-name').innerText = event.name;
    document.getElementById('lbl-organizer').innerText = event.organizer_name || "Organizer";
    document.getElementById('manual-collector').innerText = currentUpiOwnerName || "Not verified";
    
    // Show owner name below QR
    if (currentUpiOwnerName) {
      document.getElementById('lbl-upi-owner').innerText = currentUpiOwnerName;
    }

    if (!currentUpiId || !currentUpiOwnerName) {
      document.getElementById('qr-box').innerHTML = "<p style='color:red;'>Organizer hasn't verified a UPI ID yet.</p>";
      document.getElementById('btn-deep-link').style.display = "none";
    } else {
      // Generate standard UPI URL
      const upiUrl = `upi://pay?pa=${currentUpiId}&pn=${encodeURIComponent(currentUpiOwnerName)}&cu=INR`;
      
      // Wire up deep-link button to native confirmation modal
      document.getElementById('btn-deep-link').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('upi-confirm-name').innerText = currentUpiOwnerName;
        document.getElementById('upi-confirm-id').innerText = 'UPI: ' + currentUpiId;
        const modal = document.getElementById('upi-confirm-modal');
        modal.style.display = 'flex';
        document.getElementById('upi-confirm-proceed').onclick = () => {
          modal.style.display = 'none';
          window.location.href = upiUrl;
        };
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
  document.getElementById('loader-title').innerText = "Verifying Receipt...";
  document.getElementById('loader-title').style.color = "#1f2937";
  document.getElementById('loader-desc').innerText = "Our AI is reading your screenshot to confirm the payment.";

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
    if (data.status === "extraction_failed" || data.extraction_failed === true) {
      console.log("ℹ️ AI extraction failed, showing manual entry form");
      document.getElementById('loader').style.display = 'none';
      showManualEntryForm();
      return;
    }
    
    // Check if response is partial success
    if (data.status === "partial_success") {
      console.log("ℹ️ AI partial success, asking for donor name");
      document.getElementById('loader').style.display = 'none';
      currentReceiptSessionId = data.receipt_session_id;
      showManualEntryForm(true, data.amount);
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

    // Show Success UI
    document.getElementById('loader-spinner').style.display = 'none';
    document.getElementById('loader-success').style.display = 'block';
    document.getElementById('loader-title').innerText = "Payment Verified!";
    document.getElementById('loader-title').style.color = "#10b981";
    
    // Show different message based on verification status
    if (verification === "ai_verified") {
      document.getElementById('loader-desc').innerText = `✅ AI Verified!\nThank you ${name}! Your ₹${amount} donation has been recorded automatically.`;
    } else {
      document.getElementById('loader-desc').innerText = `Thank you ${name}! Your ₹${amount} donation has been recorded. (Manual entry)`;
    }
    
    // Hide buttons and show final message
    setTimeout(() => {
      document.getElementById('content').innerHTML = `
        <i class="icon-check-circle" style="font-size: 60px; color: #10b981; margin-bottom:15px;"></i>
        <h2>Thank You!</h2>
        <p>Your donation was successfully recorded.</p>
        <p style="font-size: 13px; color: #6b7280; margin-top: 15px;">
          ${verification === "ai_verified" ? "✅ AI-verified entry" : "📝 Manual entry"}
        </p>
        <p style="font-size: 12px; color: #9ca3af;">You may now close this window.</p>
      `;
      loader.style.display = 'none';
    }, 4000);

  } catch (error) {
    console.error("❌ Upload Error:", error);
    document.getElementById('loader').style.display = 'none';
    
    // Show manual entry form as fallback
    showManualEntryForm();
  }
});

// Manual Entry Form Functions
function showManualEntryForm(isPartial = false, lockedAmount = null) {
  document.getElementById('manual-entry-modal').style.display = 'flex';
  document.getElementById('manual-name').value = '';
  
  const amountInput = document.getElementById('manual-amount');
  if (isPartial && lockedAmount) {
    amountInput.value = lockedAmount;
    amountInput.disabled = true;
    amountInput.style.backgroundColor = '#f3f4f6';
    amountInput.style.color = '#6b7280';
    // Add a note above it
    let note = document.getElementById('partial-note');
    if (!note) {
      note = document.createElement('p');
      note.id = 'partial-note';
      note.style.fontSize = '12px';
      note.style.color = '#10b981';
      note.style.marginBottom = '5px';
      note.innerText = '✅ Receipt validated! Please enter your name.';
      amountInput.parentNode.insertBefore(note, amountInput);
    } else {
      note.style.display = 'block';
    }
  } else {
    amountInput.value = '';
    amountInput.disabled = false;
    amountInput.style.backgroundColor = '';
    amountInput.style.color = '';
    currentReceiptSessionId = null;
    const note = document.getElementById('partial-note');
    if (note) note.style.display = 'none';
  }
  
  document.getElementById('manual-name').focus();
}

document.getElementById('btn-manual-cancel').addEventListener('click', () => {
  document.getElementById('manual-entry-modal').style.display = 'none';
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

    // Show Success UI
    document.getElementById('loader-spinner').style.display = 'none';
    document.getElementById('loader-success').style.display = 'block';
    document.getElementById('loader-title').innerText = "Thank You!";
    document.getElementById('loader-title').style.color = "#10b981";
    document.getElementById('loader-desc').innerText = `✅ Your ₹${amount} donation has been recorded.\nThank you, ${name}!`;
    
    // Hide final message after 4 seconds
    setTimeout(() => {
      document.getElementById('content').innerHTML = `
        <i class="icon-check-circle" style="font-size: 60px; color: #10b981; margin-bottom:15px;"></i>
        <h2>Thank You!</h2>
        <p>Your donation was successfully recorded.</p>
        <p style="font-size: 13px; color: #6b7280; margin-top: 15px;">
          ${currentReceiptSessionId ? '✅ AI-Assisted partial entry' : '📝 Manual entry'} (Collected by: ${currentUpiOwnerName})
        </p>
        <p style="font-size: 12px; color: #9ca3af;">You may now close this window.</p>
      `;
      loader.style.display = 'none';
    }, 4000);

  } catch (error) {
    console.error("Manual Entry Error:", error);
    document.getElementById('loader').style.display = 'none';
    showRejectionPopup(error.message || "Failed to record donation. Please try again.");
  }
});

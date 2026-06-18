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
let donorCustomColumns = [];

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
    donorCustomColumns = event.donation_custom_columns || [];

    // Populate UI
    document.getElementById('lbl-event-name').innerText = currentEventName;
    document.getElementById('lbl-organizer').innerText = event.organizer_name || "Organizer";
    document.getElementById('manual-collector').innerText = currentUpiOwnerName || "Not verified";
    
    // Show owner name below QR
    if (currentUpiOwnerName) {
      document.getElementById('lbl-upi-owner').innerHTML = 'UPI Registered Name: <strong style="color: #10b981; font-weight: 800; font-size: 15px;">' + currentUpiOwnerName + '</strong>';
    }

    // Set UPI Copy ID container values
    const upiCopyText = document.getElementById('upi-copy-text');
    const upiCopyContainer = document.getElementById('upi-copy-container');
    if (upiCopyText && upiCopyContainer && currentUpiId) {
      upiCopyText.innerText = currentUpiId;
      upiCopyContainer.style.display = 'flex';
    }

    const lblUpiId = document.getElementById('lbl-upi-id');
    if (lblUpiId && currentUpiId) {
      lblUpiId.innerHTML = 'UPI ID: <strong style="color: #6b7280; font-weight: 600; font-size: 13px;">' + currentUpiId + '</strong>';
    }

    if (!currentUpiId || !currentUpiOwnerName) {
      document.getElementById('qr-box').innerHTML = "<p style='color:red;'>Organizer hasn't verified a UPI ID yet.</p>";
    } else {
      // Generate standard UPI URL
      const safeUpiId = currentUpiId.trim();
      const safeOwnerName = encodeURIComponent(currentUpiOwnerName.trim());
      const upiUrl = `upi://pay?pa=${safeUpiId}&pn=${safeOwnerName}&cu=INR&tn=Donation`;

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

    // Copy UPI ID Event Listener
    const btnCopyUpi = document.getElementById('btn-copy-upi');
    if (btnCopyUpi) {
      btnCopyUpi.addEventListener('click', () => {
        if (!currentUpiId) return;
        navigator.clipboard.writeText(currentUpiId).then(() => {
          showToast("UPI ID copied");
          btnCopyUpi.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
          setTimeout(() => {
            btnCopyUpi.innerHTML = `<svg class="copy-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
          }, 2000);
        }).catch(err => {
          console.error("Failed to copy UPI ID: ", err);
        });
      });
    }

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
    btnSelect.style.backgroundColor = "var(--green, #10b981)";
    btnSelect.style.color = "#ffffff";
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
      showManualEntryForm(true, data.amount, data.receiver_name, null, data.donor_name || null);
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
function showManualEntryForm(isPartial = false, lockedAmount = null, receiverName = null, fallbackSessionId = null, prefilledDonorName = null) {
  document.getElementById('manual-entry-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  window.scrollTo(0, 0);
  document.getElementById('manual-name').value = prefilledDonorName || '';

  // Render custom fields
  const container = document.getElementById('dynamic-custom-fields-container');
  container.innerHTML = "";
  donorCustomColumns.forEach(col => {
    if (col && typeof col === 'object' && col.reqByDonor && !col.hidden) {
      const wrapper = document.createElement('div');
      wrapper.style.marginBottom = '12px';
      const label = document.createElement('label');
      label.style.display = 'block';
      label.style.fontWeight = '600';
      label.style.color = '#374151';
      label.style.marginBottom = '6px';
      label.style.fontSize = '14px';
      label.innerText = col.n + " *";
      
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'donor-custom-field';
      input.dataset.colName = col.n;
      input.placeholder = "Enter " + col.n;
      input.style.width = '100%';
      input.style.padding = '12px';
      input.style.border = '1px solid #d1d5db';
      input.style.borderRadius = '8px';
      input.style.fontSize = '14px';
      input.style.boxSizing = 'border-box';
      
      const err = document.createElement('div');
      err.className = 'err-custom-field';
      err.dataset.colName = col.n;
      err.style.display = 'none';
      err.style.color = '#ef4444';
      err.style.fontSize = '12px';
      err.style.marginTop = '4px';
      
      wrapper.appendChild(label);
      wrapper.appendChild(input);
      wrapper.appendChild(err);
      container.appendChild(wrapper);
    }
  });
  
  const verifiedMsg = document.getElementById('manual-verified-msg');
  const descMsg = document.getElementById('manual-desc-msg');
  
  const amountInput = document.getElementById('manual-amount');
  if (isPartial && lockedAmount) {
    if (verifiedMsg) verifiedMsg.style.display = 'flex';
    if (descMsg) descMsg.innerHTML = "We have successfully verified your payment receipt.<br><br>To complete your donation record, please fill out the remaining details below.";
    amountInput.value = lockedAmount;
    amountInput.disabled = true;
    amountInput.style.backgroundColor = '#f3f4f6';
    
    if (receiverName) {
      document.getElementById('manual-collector').innerText = receiverName;
    }
    const noteText = document.getElementById('manual-note-text');
    if (noteText) {
      if (prefilledDonorName) {
        noteText.innerHTML = `<strong>Receipt Verified</strong><br>Your payment details have been extracted. Please verify the details, fill out any required custom fields, and submit to complete your donation.`;
      } else {
        noteText.innerHTML = `<strong>Receipt Verified</strong><br>Your payment details have been extracted from the receipt. Enter your name and submit to complete your donation record.`;
      }
    }
    document.getElementById('manual-collector-label').innerText = "UPI Registered Name";
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
  }
  
  document.getElementById('manual-name').focus();
}

document.getElementById('btn-manual-cancel').addEventListener('click', () => {
  document.getElementById('manual-entry-modal').style.display = 'none';
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
});

document.getElementById('btn-manual-submit').addEventListener('click', async () => {
  const name = document.getElementById('manual-name').value.trim();
  const amount = parseFloat(document.getElementById('manual-amount').value);

  // Clear previous errors
  const errName = document.getElementById('err-manual-name');
  const errAmt = document.getElementById('err-manual-amount');
  errName.style.display = 'none';
  errAmt.style.display = 'none';
  document.querySelectorAll('.err-custom-field').forEach(el => el.style.display = 'none');

  let hasError = false;
  if (!name || name.length < 2) {
    errName.innerText = 'Please enter a valid name (min 2 characters).';
    errName.style.display = 'block';
    hasError = true;
  }
  if (!amount || amount <= 0) {
    errAmt.innerText = 'Please enter a valid amount greater than 0.';
    errAmt.style.display = 'block';
    hasError = true;
  }
  
  // Validate custom fields
  const customFields = {};
  document.querySelectorAll('.donor-custom-field').forEach(inp => {
    const val = inp.value.trim();
    const colName = inp.dataset.colName;
    if (!val) {
      const errDiv = document.querySelector(`.err-custom-field[data-col-name="${colName}"]`);
      if (errDiv) {
        errDiv.innerText = `${colName} is required.`;
        errDiv.style.display = 'block';
      }
      hasError = true;
    } else {
      customFields[colName] = val;
    }
  });
  
  if (hasError) return;

  // Hide modal and show loader
  document.getElementById('manual-entry-modal').style.display = 'none';
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
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
        receipt_session_id: currentReceiptSessionId,
        custom_fields: Object.keys(customFields).length > 0 ? customFields : undefined
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

// Sticky brand header scroll effect
window.addEventListener('scroll', () => {
  const brand = document.querySelector('.top-brand');
  if (brand) {
    if (window.scrollY > 5) {
      brand.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.05)';
      brand.style.borderBottom = '1px solid rgba(0, 0, 0, 0.08)';
    } else {
      brand.style.boxShadow = 'none';
      brand.style.borderBottom = '1px solid transparent';
    }
  }
});

// Toast notification helper
function showToast(msg) {
  let toast = document.getElementById('toast-notification');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-notification';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: #111827;
      color: #ffffff;
      padding: 12px 24px;
      border-radius: 30px;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
      z-index: 9999;
      transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s;
      opacity: 0;
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    document.body.appendChild(toast);
  }
  toast.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
    <span>${msg}</span>
  `;
  
  // Trigger animation
  requestAnimationFrame(() => {
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.opacity = '1';
  });
  
  // Hide after 2 seconds
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(100px)';
    toast.style.opacity = '0';
  }, 2000);
}

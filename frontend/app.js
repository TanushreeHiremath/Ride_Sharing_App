// Backend base URL
const API_BASE = "https://ride-sharing-app-zm7p.onrender.com";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------- Mapbox Setup (SAFE) ----------
let riderMap, adminMap;
let riderMarkers = { pickup: null, drop: null, driver: null };
let adminDriverMarkers = [];
let mapboxAvailable = false;
const DEFAULT_CENTER = [77.5946, 12.9716]; // [lon, lat]

// Run everything after DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  // 1) Try Mapbox init
  if (typeof mapboxgl !== "undefined") {
    // 🔴 PUT YOUR OWN TOKEN HERE:
    mapboxgl.accessToken =
      "pk.eyJ1IjoidGFudXNocmVlMTIzNCIsImEiOiJjbWRrYnllZjAwdmExMmxwa2t6cWEwbHlkIn0.THXI5SuOhmaQ8iMLQpiWXA";
    mapboxAvailable = true;

    const riderMapEl = document.getElementById("rider-map");
    if (riderMapEl) {
      riderMap = new mapboxgl.Map({
        container: "rider-map",
        style: "mapbox://styles/mapbox/dark-v11",
        center: DEFAULT_CENTER,
        zoom: 11,
      });
      riderMap.addControl(new mapboxgl.NavigationControl());
    }

    const adminMapEl = document.getElementById("admin-map");
    if (adminMapEl) {
      adminMap = new mapboxgl.Map({
        container: "admin-map",
        style: "mapbox://styles/mapbox/dark-v11",
        center: DEFAULT_CENTER,
        zoom: 11,
      });
      adminMap.addControl(new mapboxgl.NavigationControl());
    }
  } else {
    console.warn("Mapbox GL JS not loaded. Maps disabled, app still works.");
  }

  // 2) Tabs
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const tab = btn.dataset.tab;
      $$(".tab-content").forEach((sec) => sec.classList.remove("active"));
      document.getElementById(tab).classList.add("active");

      // Force maps to redraw when tab becomes visible
      setTimeout(() => {
        if (riderMap) riderMap.resize();
        if (adminMap) adminMap.resize();
      }, 200);
    });
  });

  // 3) App logic
  setupRiderLogic();
  setupDriverLogic();
  setupAdminLogic();
  setupGeocodeButtons(); // 🆕 address → lat/lon wiring
});

// ----------------- Geocoding Helper (Mapbox) -----------------
async function geocodeAddress(address) {
  if (!address || !address.trim()) {
    throw new Error("Empty address");
  }
  if (typeof mapboxgl === "undefined" || !mapboxgl.accessToken) {
    throw new Error("Mapbox not initialized");
  }

  const url =
    "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
    encodeURIComponent(address) +
    ".json?access_token=" +
    encodeURIComponent(mapboxgl.accessToken) +
    "&limit=1";

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Geocoding failed with status " + res.status);
  }
  const data = await res.json();
  if (!data.features || data.features.length === 0) {
    throw new Error("No results for this address");
  }

  const [lon, lat] = data.features[0].center;
  return { lat, lon, place: data.features[0].place_name };
}

// ----------------- Set up address → lat/lon buttons -----------------
function setupGeocodeButtons() {
  // --- Rider: Pickup ---
  const pickupBtn = $("#pickup-geocode-btn");
  const pickupAddressInput = $("#pickup-address");
  const pickupLatInput = $("#pickup-lat");
  const pickupLonInput = $("#pickup-lon");
  const riderStatus = $("#rider-status");

  if (pickupBtn && pickupAddressInput && pickupLatInput && pickupLonInput) {
    pickupBtn.addEventListener("click", async () => {
      const addr = pickupAddressInput.value.trim();
      if (!addr) {
        alert("Please enter a pickup address first.");
        return;
      }

      const oldText = pickupBtn.textContent;
      pickupBtn.disabled = true;
      pickupBtn.textContent = "Locating...";

      try {
        const { lat, lon, place } = await geocodeAddress(addr);
        pickupLatInput.value = lat.toFixed(6);
        pickupLonInput.value = lon.toFixed(6);

        if (riderStatus) {
          riderStatus.textContent = "Pickup location found: " + place;
          riderStatus.className = "status-text success";
        }

        if (mapboxAvailable && riderMap) {
          riderMap.setCenter([lon, lat]);
          riderMap.setZoom(13);
        }
      } catch (err) {
        alert("Could not find pickup location: " + err.message);
        if (riderStatus) {
          riderStatus.textContent = "Pickup geocoding failed.";
          riderStatus.className = "status-text error";
        }
      } finally {
        pickupBtn.disabled = false;
        pickupBtn.textContent = oldText;
      }
    });
  }

  // --- Rider: Dropoff ---
  const dropBtn = $("#drop-geocode-btn");
  const dropAddressInput = $("#drop-address");
  const dropLatInput = $("#drop-lat");
  const dropLonInput = $("#drop-lon");

  if (dropBtn && dropAddressInput && dropLatInput && dropLonInput) {
    dropBtn.addEventListener("click", async () => {
      const addr = dropAddressInput.value.trim();
      if (!addr) {
        alert("Please enter a dropoff address first.");
        return;
      }

      const oldText = dropBtn.textContent;
      dropBtn.disabled = true;
      dropBtn.textContent = "Locating...";

      try {
        const { lat, lon, place } = await geocodeAddress(addr);
        dropLatInput.value = lat.toFixed(6);
        dropLonInput.value = lon.toFixed(6);

        if (riderStatus) {
          riderStatus.textContent = "Dropoff location found: " + place;
          riderStatus.className = "status-text success";
        }

        if (mapboxAvailable && riderMap) {
          riderMap.setCenter([lon, lat]);
          riderMap.setZoom(13);
        }
      } catch (err) {
        alert("Could not find dropoff location: " + err.message);
        if (riderStatus) {
          riderStatus.textContent = "Dropoff geocoding failed.";
          riderStatus.className = "status-text error";
        }
      } finally {
        dropBtn.disabled = false;
        dropBtn.textContent = oldText;
      }
    });
  }

  // --- Driver: Location Update ---
  const driverBtn = $("#driver-geocode-btn");
  const driverAddressInput = $("#driver-address");
  const driverLatInput = $("#driver-lat");
  const driverLonInput = $("#driver-lon");
  const driverStatus = $("#driver-location-status");

  if (driverBtn && driverAddressInput && driverLatInput && driverLonInput) {
    driverBtn.addEventListener("click", async () => {
      const addr = driverAddressInput.value.trim();
      if (!addr) {
        alert("Please enter a driver address first.");
        return;
      }

      const oldText = driverBtn.textContent;
      driverBtn.disabled = true;
      driverBtn.textContent = "Locating...";

      try {
        const { lat, lon, place } = await geocodeAddress(addr);
        driverLatInput.value = lat.toFixed(6);
        driverLonInput.value = lon.toFixed(6);

        if (driverStatus) {
          driverStatus.textContent = "Location found: " + place;
          driverStatus.className = "status-text success";
        }

        if (mapboxAvailable && adminMap) {
          adminMap.setCenter([lon, lat]);
          adminMap.setZoom(13);
        }
      } catch (err) {
        alert("Could not find driver location: " + err.message);
        if (driverStatus) {
          driverStatus.textContent = "Driver geocoding failed.";
          driverStatus.className = "status-text error";
        }
      } finally {
        driverBtn.disabled = false;
        driverBtn.textContent = oldText;
      }
    });
  }
}

// ----------------- Rider Logic -----------------
function setupRiderLogic() {
  const riderForm = $("#rider-form");
  const riderStatus = $("#rider-status");
  const riderResult = $("#rider-result");
  if (!riderForm) return;

  riderForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    riderStatus.textContent = "Finding nearest driver...";
    riderStatus.className = "status-text";
    riderResult.classList.add("hidden");
    riderResult.innerHTML = "";

    const formData = new FormData(riderForm);
    const payload = Object.fromEntries(formData.entries());

    payload.pickup_lat = parseFloat(payload.pickup_lat);
    payload.pickup_lon = parseFloat(payload.pickup_lon);
    payload.drop_lat = parseFloat(payload.drop_lat);
    payload.drop_lon = parseFloat(payload.drop_lon);
    payload.max_distance_km = parseFloat(payload.max_distance_km || 5);

    try {
      const res = await fetch(`${API_BASE}/api/riders/request-ride`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        riderStatus.textContent = data.error || "Something went wrong.";
        riderStatus.className = "status-text error";
        return;
      }

      riderStatus.textContent = "Ride created successfully!";
      riderStatus.className = "status-text success";

      riderResult.classList.remove("hidden");
      riderResult.innerHTML = `
        <p><strong>Ride ID:</strong> ${data.ride_id}</p>
        <p><strong>Driver:</strong> ${data.driver.name} (${data.driver.phone})</p>
        <p><strong>Estimated Distance:</strong> ${data.distance_km} km</p>
        <p><strong>Estimated Duration:</strong> ${data.duration_min} min</p>
        <p><strong>Estimated Fare:</strong> ₹${data.fare}</p>
        <p style="margin-top:6px; color:#9ca3af; font-size:12px;">You can view this ride in the Admin > Ongoing Rides section.</p>
      `;

      if (mapboxAvailable && riderMap) {
        Object.values(riderMarkers).forEach((m) => m && m.remove());

        const pickupLng = payload.pickup_lon;
        const pickupLat = payload.pickup_lat;
        const dropLng = payload.drop_lon;
        const dropLat = payload.drop_lat;

        riderMarkers.pickup = new mapboxgl.Marker({ color: "#22c55e" })
          .setLngLat([pickupLng, pickupLat])
          .setPopup(
            new mapboxgl.Popup({ offset: 12 }).setHTML(
              `<strong>Pickup</strong><br>${payload.pickup_address || ""}`
            )
          )
          .addTo(riderMap);

        riderMarkers.drop = new mapboxgl.Marker({ color: "#f97316" })
          .setLngLat([dropLng, dropLat])
          .setPopup(
            new mapboxgl.Popup({ offset: 12 }).setHTML(
              `<strong>Dropoff</strong><br>${payload.drop_address || ""}`
            )
          )
          .addTo(riderMap);

        riderMarkers.driver = new mapboxgl.Marker({ color: "#6366f1" })
          .setLngLat([pickupLng, pickupLat])
          .setPopup(
            new mapboxgl.Popup({ offset: 12 }).setHTML(
              `<strong>Driver: ${data.driver.name}</strong><br>${data.driver.phone}`
            )
          )
          .addTo(riderMap);

        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend([pickupLng, pickupLat]);
        bounds.extend([dropLng, dropLat]);
        riderMap.fitBounds(bounds, { padding: 60, maxZoom: 14 });
      }
    } catch (err) {
      riderStatus.textContent = "Network error: " + err.message;
      riderStatus.className = "status-text error";
    }
  });
}

// ----------------- Driver Logic -----------------
function setupDriverLogic() {
  const driverRegisterForm = $("#driver-register-form");
  const driverRegisterStatus = $("#driver-register-status");
  const driverLocationForm = $("#driver-location-form");
  const driverLocationStatus = $("#driver-location-status");

  if (driverRegisterForm) {
    driverRegisterForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      driverRegisterStatus.textContent = "Saving driver...";
      driverRegisterStatus.className = "status-text";

      const formData = new FormData(driverRegisterForm);
      const payload = Object.fromEntries(formData.entries());

      try {
        const res = await fetch(`${API_BASE}/api/drivers/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (!res.ok) {
          driverRegisterStatus.textContent =
            data.error || "Failed to save driver.";
          driverRegisterStatus.className = "status-text error";
          return;
        }

        driverRegisterStatus.textContent = "Driver saved successfully!";
        driverRegisterStatus.className = "status-text success";
      } catch (err) {
        driverRegisterStatus.textContent = "Network error: " + err.message;
        driverRegisterStatus.className = "status-text error";
      }
    });
  }

  if (driverLocationForm) {
    driverLocationForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      driverLocationStatus.textContent = "Updating location...";
      driverLocationStatus.className = "status-text";

      const formData = new FormData(driverLocationForm);
      const payload = Object.fromEntries(formData.entries());
      payload.lat = parseFloat(payload.lat);
      payload.lon = parseFloat(payload.lon);

      try {
        const res = await fetch(`${API_BASE}/api/drivers/location`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (!res.ok) {
          driverLocationStatus.textContent =
            data.error || "Failed to update.";
          driverLocationStatus.className = "status-text error";
          return;
        }

        driverLocationStatus.textContent = "Location updated!";
        driverLocationStatus.className = "status-text success";
      } catch (err) {
        driverLocationStatus.textContent = "Network error: " + err.message;
        driverLocationStatus.className = "status-text error";
      }
    });
  }
}

// ----------------- Admin Logic -----------------
function setupAdminLogic() {
  const adminSummaryEl = $("#admin-summary");
  const ongoingRidesEl = $("#ongoing-rides");
  const recentRidesEl = $("#recent-rides");
  const topDriversEl = $("#top-drivers");
  const refreshAdminBtn = $("#refresh-admin");
  if (!adminSummaryEl || !refreshAdminBtn) return;

  async function loadAdminData() {
    adminSummaryEl.innerHTML = "<span class='status-text'>Loading...</span>";
    ongoingRidesEl.innerHTML = "";
    recentRidesEl.innerHTML = "";
    topDriversEl.innerHTML = "";

    try {
      const [summaryRes, ongoingRes, recentRes, topRes, locRes] =
        await Promise.all([
          fetch(`${API_BASE}/api/admin/summary`),
          fetch(`${API_BASE}/api/rides/ongoing`),
          fetch(`${API_BASE}/api/admin/recent-rides`),
          fetch(`${API_BASE}/api/admin/top-drivers`),
          fetch(`${API_BASE}/api/drivers/locations`),
        ]);

      const summary = await summaryRes.json();
      const ongoing = await ongoingRes.json();
      const recent = await recentRes.json();
      const topDrivers = await topRes.json();
      const driverLocations = await locRes.json();

      adminSummaryEl.innerHTML = `
        <div class="summary-item">
          <div class="summary-label">Total Rides</div>
          <div class="summary-value">${summary.total_rides}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Completed</div>
          <div class="summary-value">${summary.completed_rides}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">Ongoing</div>
          <div class="summary-value">${summary.ongoing_rides}</div>
        </div>
      `;

      if (ongoing.length === 0) {
        ongoingRidesEl.innerHTML =
          "<span class='status-text'>No ongoing rides.</span>";
      } else {
        ongoing.forEach((r) => {
          const item = document.createElement("div");
          item.className = "list-item";

          const main = document.createElement("div");
          main.className = "list-item-main";
          main.innerHTML = `
            <span><strong>Ride:</strong> ${r.ride_id}</span>
            <span class="list-item-meta">Fare: ₹${r.fare} • Distance: ${r.distance_km} km</span>
          `;

          const right = document.createElement("div");
          const badge = document.createElement("span");
          badge.className = "badge yellow";
          badge.textContent = r.status.toUpperCase();
          right.appendChild(badge);

          const btn = document.createElement("button");
          btn.className = "btn small secondary";
          btn.textContent = "Complete";
          btn.addEventListener("click", () =>
            completeRide(r.ride_id, loadAdminData)
          );
          right.appendChild(btn);

          item.appendChild(main);
          item.appendChild(right);
          ongoingRidesEl.appendChild(item);
        });
      }

      if (recent.length === 0) {
        recentRidesEl.innerHTML =
          "<span class='status-text'>No rides yet.</span>";
      } else {
        recent.forEach((r) => {
          const item = document.createElement("div");
          item.className = "list-item";

          const main = document.createElement("div");
          main.className = "list-item-main";
          main.innerHTML = `
            <span><strong>Ride:</strong> ${r.ride_id}</span>
            <span class="list-item-meta">Fare: ₹${r.fare} • Distance: ${r.distance_km} km</span>
          `;

          const right = document.createElement("div");
          const badge = document.createElement("span");
          badge.className =
            r.status === "completed" ? "badge green" : "badge blue";
          badge.textContent = r.status.toUpperCase();
          right.appendChild(badge);

          item.appendChild(main);
          item.appendChild(right);
          recentRidesEl.appendChild(item);
        });
      }

      if (topDrivers.length === 0) {
        topDriversEl.innerHTML =
          "<span class='status-text'>No drivers yet.</span>";
      } else {
        topDrivers.forEach((d) => {
          const item = document.createElement("div");
          item.className = "list-item";
          item.innerHTML = `
            <div class="list-item-main">
              <span><strong>${d.name}</strong> (${d.phone})</span>
              <span class="list-item-meta">Rating: ${d.rating} • Rides: ${d.total_rides}</span>
            </div>
            <span class="badge blue">TOP</span>
          `;
          topDriversEl.appendChild(item);
        });
      }

      if (mapboxAvailable && adminMap) {
        adminDriverMarkers.forEach((m) => m.remove());
        adminDriverMarkers = [];

        if (driverLocations.length > 0) {
          const bounds = new mapboxgl.LngLatBounds();

          driverLocations.forEach((d) => {
            const color =
              d.status === "available"
                ? "#22c55e"
                : d.status === "on_ride"
                ? "#facc15"
                : "#6b7280";

            const marker = new mapboxgl.Marker({ color })
              .setLngLat([d.lon, d.lat])
              .setPopup(
                new mapboxgl.Popup({ offset: 12 }).setHTML(
                  `<strong>${d.name}</strong><br>${d.phone}<br>Status: ${d.status}`
                )
              )
              .addTo(adminMap);

            adminDriverMarkers.push(marker);
            bounds.extend([d.lon, d.lat]);
          });

          if (!bounds.isEmpty()) {
            adminMap.fitBounds(bounds, { padding: 60, maxZoom: 13 });
          }
        }
      }
    } catch (err) {
      adminSummaryEl.innerHTML =
        "<span class='status-text error'>Failed to load admin data.</span>";
    }
  }

  refreshAdminBtn.addEventListener("click", loadAdminData);
  loadAdminData();
}

async function completeRide(rideId, refreshFn) {
  try {
    const res = await fetch(`${API_BASE}/api/rides/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ride_id: rideId }),
    });
    const data = await res.json();

    if (!res.ok) {
      alert("Failed to complete ride: " + (data.error || "Unknown error"));
      return;
    }

    alert("Ride completed!");
    if (typeof refreshFn === "function") refreshFn();
  } catch (err) {
    alert("Network error: " + err.message);
  }
}


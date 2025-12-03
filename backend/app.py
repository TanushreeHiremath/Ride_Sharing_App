import math
from datetime import datetime

from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient, GEOSPHERE
from bson import ObjectId

from config import MONGO_URI, MONGO_DB_NAME


# ------------------------
# DB Setup
# ------------------------
client = MongoClient(MONGO_URI)
db = client[MONGO_DB_NAME]

users_col = db["users"]
drivers_col = db["drivers"]
vehicles_col = db["vehicles"]
driver_locations_col = db["driver_locations"]
rides_col = db["rides"]

# Create geospatial indexes
driver_locations_col.create_index([("location", GEOSPHERE)])
rides_col.create_index([("pickup.location", GEOSPHERE)])
rides_col.create_index([("dropoff.location", GEOSPHERE)])


# ------------------------
# Utility Functions
# ------------------------

def haversine_distance_km(lon1, lat1, lon2, lat2):
    """Calculate distance in km between two lon/lat points."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def calculate_fare(distance_km, duration_min, surge=1.0):
    base_fare = 50
    per_km = 10
    per_minute = 2
    total = (base_fare + distance_km * per_km + duration_min * per_minute) * surge
    return round(total, 2), base_fare, per_km, per_minute


# ------------------------
# Flask App
# ------------------------

app = Flask(__name__)
CORS(app)  # allow frontend to call APIs from another port


# ------------------------
# Driver APIs
# ------------------------

@app.route("/api/drivers/register", methods=["POST"])
def register_driver():
    data = request.json or {}

    name = data.get("name")
    phone = data.get("phone")
    email = data.get("email", "")
    vehicle_type = data.get("vehicle_type", "car")
    vehicle_model = data.get("vehicle_model", "Unknown")
    plate_number = data.get("plate_number", "")

    if not name or not phone:
        return jsonify({"error": "name and phone are required"}), 400

    driver = drivers_col.find_one({"phone": phone})
    if driver:
        driver_id = driver["_id"]
        drivers_col.update_one(
            {"_id": driver_id},
            {"$set": {"name": name, "phone": phone, "email": email}},
        )
    else:
        driver_id = drivers_col.insert_one(
            {
                "name": name,
                "phone": phone,
                "email": email,
                "status": "available",
                "rating": 5.0,
                "total_rides": 0,
                "created_at": datetime.utcnow(),
            }
        ).inserted_id

    vehicles_col.update_one(
        {"driver_id": driver_id},
        {
            "$set": {
                "driver_id": driver_id,
                "type": vehicle_type,
                "model": vehicle_model,
                "plate_number": plate_number,
                "capacity": 4,
            }
        },
        upsert=True,
    )

    return jsonify({"message": "driver registered/updated", "driver_id": str(driver_id)})


@app.route("/api/drivers/location", methods=["POST"])
def update_driver_location():
    data = request.json or {}

    phone = data.get("phone")
    lat = data.get("lat")
    lon = data.get("lon")
    status = data.get("status", "available")

    if not phone or lat is None or lon is None:
        return jsonify({"error": "phone, lat, lon required"}), 400

    driver = drivers_col.find_one({"phone": phone})
    if not driver:
        return jsonify({"error": "driver not found, register first"}), 404

    driver_id = driver["_id"]

    driver_locations_col.update_one(
        {"driver_id": driver_id},
        {
            "$set": {
                "driver_id": driver_id,
                "location": {
                    "type": "Point",
                    "coordinates": [float(lon), float(lat)],  # [lon, lat]
                },
                "last_updated": datetime.utcnow(),
                "status": status,
            }
        },
        upsert=True,
    )

    drivers_col.update_one({"_id": driver_id}, {"$set": {"status": status}})

    return jsonify({"message": "location updated"})


@app.route("/api/drivers/locations", methods=["GET"])
def get_driver_locations():
    docs = list(driver_locations_col.find({}))
    result = []
    for d in docs:
        driver = drivers_col.find_one({"_id": d["driver_id"]})
        result.append(
            {
                "driver_id": str(d["driver_id"]),
                "name": driver["name"] if driver else "Unknown",
                "phone": driver["phone"] if driver else "",
                "status": d.get("status", "unknown"),
                "lon": d["location"]["coordinates"][0],
                "lat": d["location"]["coordinates"][1],
            }
        )
    return jsonify(result)


# ------------------------
# Rider / Ride APIs
# ------------------------

@app.route("/api/riders/request-ride", methods=["POST"])
def request_ride():
    data = request.json or {}

    rider_name = data.get("rider_name")
    rider_phone = data.get("rider_phone")

    pickup_lat = data.get("pickup_lat")
    pickup_lon = data.get("pickup_lon")
    pickup_address = data.get("pickup_address", "")

    drop_lat = data.get("drop_lat")
    drop_lon = data.get("drop_lon")
    drop_address = data.get("drop_address", "")

    max_distance_km = float(data.get("max_distance_km", 5))

    if not rider_name or not rider_phone:
        return jsonify({"error": "rider_name and rider_phone required"}), 400

    if None in [pickup_lat, pickup_lon, drop_lat, drop_lon]:
        return jsonify({"error": "pickup and drop coordinates required"}), 400

    # cast to float
    pickup_lat = float(pickup_lat)
    pickup_lon = float(pickup_lon)
    drop_lat = float(drop_lat)
    drop_lon = float(drop_lon)

    # upsert rider
    rider = users_col.find_one({"phone": rider_phone})
    if rider:
        rider_id = rider["_id"]
    else:
        rider_id = users_col.insert_one(
            {
                "name": rider_name,
                "phone": rider_phone,
                "created_at": datetime.utcnow(),
                "rating": 5.0,
            }
        ).inserted_id

    pickup_point = {"type": "Point", "coordinates": [pickup_lon, pickup_lat]}
    max_distance_m = max_distance_km * 1000

    try:
        nearby = driver_locations_col.find(
            {
                "location": {
                    "$near": {
                        "$geometry": pickup_point,
                        "$maxDistance": max_distance_m,
                    }
                },
                "status": "available",
            }
        ).limit(1)
        nearby = list(nearby)
    except Exception as e:
        return jsonify({"error": f"geospatial query failed: {e}"}), 500

    if not nearby:
        return jsonify({"error": "no drivers available nearby"}), 404

    driver_loc_doc = nearby[0]
    driver = drivers_col.find_one({"_id": driver_loc_doc["driver_id"]})

    if not driver:
        return jsonify({"error": "driver data missing"}), 500

    # Estimate distance & duration
    distance_km = haversine_distance_km(
        pickup_lon, pickup_lat, drop_lon, drop_lat
    )
    duration_min = (distance_km / 30.0) * 60.0 if distance_km > 0 else 10.0

    surge_multiplier = 1.0
    total_fare, base_fare, per_km, per_minute = calculate_fare(
        distance_km, duration_min, surge_multiplier
    )

    ride_doc = {
        "rider_id": rider_id,
        "driver_id": driver["_id"],
        "pickup": {
            "address": pickup_address,
            "location": {
                "type": "Point",
                "coordinates": [pickup_lon, pickup_lat],
            },
        },
        "dropoff": {
            "address": drop_address,
            "location": {
                "type": "Point",
                "coordinates": [drop_lon, drop_lat],
            },
        },
        "requested_at": datetime.utcnow(),
        "accepted_at": datetime.utcnow(),
        "status": "ongoing",
        "distance_km": round(distance_km, 2),
        "duration_min": round(duration_min, 1),
        "pricing": {
            "base_fare": base_fare,
            "per_km": per_km,
            "per_minute": per_minute,
            "surge_multiplier": surge_multiplier,
            "total_fare": total_fare,
        },
        "payment_status": "pending",
    }

    ride_id = rides_col.insert_one(ride_doc).inserted_id

    # update driver status
    drivers_col.update_one({"_id": driver["_id"]}, {"$set": {"status": "on_ride"}})
    driver_locations_col.update_one(
        {"_id": driver_loc_doc["_id"]}, {"$set": {"status": "on_ride"}}
    )

    response = {
        "message": "ride created",
        "ride_id": str(ride_id),
        "driver": {
            "name": driver["name"],
            "phone": driver["phone"],
        },
        "distance_km": ride_doc["distance_km"],
        "duration_min": ride_doc["duration_min"],
        "fare": total_fare,
    }

    return jsonify(response)


@app.route("/api/rides/ongoing", methods=["GET"])
def list_ongoing_rides():
    ongoing = list(rides_col.find({"status": "ongoing"}).sort("requested_at", -1))
    result = []
    for r in ongoing:
        result.append(
            {
                "ride_id": str(r["_id"]),
                "status": r["status"],
                "fare": r["pricing"]["total_fare"],
                "distance_km": r.get("distance_km"),
                "driver_id": str(r["driver_id"]),
                "rider_id": str(r["rider_id"]),
            }
        )
    return jsonify(result)


@app.route("/api/rides/complete", methods=["POST"])
def complete_ride():
    data = request.json or {}
    ride_id = data.get("ride_id")

    if not ride_id:
        return jsonify({"error": "ride_id required"}), 400

    ride = rides_col.find_one({"_id": ObjectId(ride_id)})
    if not ride:
        return jsonify({"error": "ride not found"}), 404

    rides_col.update_one(
        {"_id": ride["_id"]},
        {
            "$set": {
                "status": "completed",
                "completed_at": datetime.utcnow(),
                "payment_status": "paid",
            }
        },
    )

    driver_id = ride["driver_id"]
    drivers_col.update_one({"_id": driver_id}, {"$set": {"status": "available"}})
    driver_locations_col.update_one(
        {"driver_id": driver_id}, {"$set": {"status": "available"}}
    )

    return jsonify({"message": "ride completed"})


# ------------------------
# Admin APIs
# ------------------------

@app.route("/api/admin/summary", methods=["GET"])
def admin_summary():
    total_rides = rides_col.count_documents({})
    completed_rides = rides_col.count_documents({"status": "completed"})
    ongoing_rides = rides_col.count_documents({"status": "ongoing"})

    return jsonify(
        {
            "total_rides": total_rides,
            "completed_rides": completed_rides,
            "ongoing_rides": ongoing_rides,
        }
    )


@app.route("/api/admin/recent-rides", methods=["GET"])
def admin_recent_rides():
    recent = list(rides_col.find().sort("requested_at", -1).limit(10))
    result = []
    for r in recent:
        result.append(
            {
                "ride_id": str(r["_id"]),
                "status": r["status"],
                "fare": r["pricing"]["total_fare"],
                "distance_km": r.get("distance_km"),
                "requested_at": r.get("requested_at").isoformat()
                if r.get("requested_at")
                else None,
            }
        )
    return jsonify(result)


@app.route("/api/admin/top-drivers", methods=["GET"])
def admin_top_drivers():
    top = list(
        drivers_col.find().sort([("rating", -1), ("total_rides", -1)]).limit(5)
    )
    result = []
    for d in top:
        result.append(
            {
                "name": d["name"],
                "phone": d["phone"],
                "rating": d.get("rating", 0),
                "total_rides": d.get("total_rides", 0),
            }
        )
    return jsonify(result)


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)


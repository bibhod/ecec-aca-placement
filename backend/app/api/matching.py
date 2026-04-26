"""
Placement Matching Engine (Issue 20)
Suggests placement centres to a student based on:
  1. Location proximity (lat/lng or suburb/state match)
  2. Centre availability (current_student_count < max_students)
  3. Centre requirements (accepted_qualifications)
  4. Student preferences (preferred_suburb, preferred_state)
"""
import math
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List

from app.database import get_db
from app.models import Student, PlacementCentre, User
from app.utils.auth import get_current_user

router = APIRouter()


def _haversine(lat1, lng1, lat2, lng2) -> float:
    """Return great-circle distance in km between two lat/lng points."""
    R = 6371  # Earth radius in km
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _score_centre(centre: PlacementCentre, student: Student) -> dict:
    """
    Score a centre for a given student and return a match dict.
    Higher score = better match.
    """
    score = 0
    reasons = []

    # 1. Availability
    current = db_count_students(centre)
    available_spots = (centre.max_students or 5) - current
    if available_spots <= 0:
        return None   # full — exclude
    score += min(available_spots, 5) * 10
    reasons.append(f"{available_spots} spot(s) available")

    # 2. Qualification match
    accepted = centre.accepted_qualifications or []
    if not accepted or student.qualification in accepted:
        score += 30
        reasons.append("Qualification accepted")
    else:
        return None   # doesn't accept this qual

    # 3. Location preference — exact suburb/state match
    if student.preferred_suburb and centre.suburb:
        if student.preferred_suburb.lower() == centre.suburb.lower():
            score += 50
            reasons.append("Preferred suburb match")
    if student.preferred_state and centre.state:
        if student.preferred_state.upper() == centre.state.upper():
            score += 20
            reasons.append("Preferred state match")

    # 4. Geo-proximity (if coordinates available)
    distance_km = None
    if (
        student.preferred_suburb  # use as a proxy hint; real lat/lng would come from geocoding
        and centre.latitude and centre.longitude
    ):
        # Without student lat/lng, we can't compute distance; skip
        pass

    return {
        "centre_id": centre.id,
        "centre_name": centre.centre_name,
        "address": ", ".join(filter(None, [centre.address, centre.suburb, centre.state, centre.postcode])),
        "nqs_rating": centre.nqs_rating,
        "available_spots": available_spots,
        "supervisor_name": centre.supervisor_name,
        "supervisor_email": centre.supervisor_email,
        "supervisor_phone": centre.supervisor_phone,
        "score": score,
        "match_reasons": reasons,
        "distance_km": distance_km,
    }


# Keep a reference to db for _score_centre — passed in from list_matches
_current_db = None


def db_count_students(centre: PlacementCentre) -> int:
    """Count active students at a centre using the global db reference."""
    if _current_db is None:
        return 0
    from app.models import Student as Stu
    return _current_db.query(Stu).filter(
        Stu.placement_centre_id == centre.id,
        Stu.status == "current",
    ).count()


@router.get("/suggest/{student_id}")
def suggest_centres(
    student_id: str,
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Return top-N centre suggestions for a student (Issue 20).
    """
    global _current_db
    _current_db = db

    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    centres = db.query(PlacementCentre).filter(PlacementCentre.approved == True).all()
    matches = []
    for c in centres:
        result = _score_centre(c, student)
        if result:
            matches.append(result)

    matches.sort(key=lambda x: x["score"], reverse=True)
    return {
        "student_id": student_id,
        "student_name": student.full_name,
        "qualification": student.qualification,
        "preferred_suburb": student.preferred_suburb,
        "preferred_state": student.preferred_state,
        "suggestions": matches[:limit],
    }

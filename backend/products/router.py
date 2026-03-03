"""
Products API — full CRUD with file uploads.
"""
import os
import uuid
import shutil
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel

from backend.database import get_db
from backend.models import Product, ProductFile
from backend.auth.dependencies import get_current_user, require_admin
from backend.config import UPLOAD_DIR

router = APIRouter(prefix="/api/products", tags=["Products"])

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_DOC_TYPES = {"application/pdf", "application/msword",
                     "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


# ── Schemas ───────────────────────────────────────────
class ProductFileResponse(BaseModel):
    id: int
    file_type: str
    file_path: str
    original_name: str
    display_order: int

    class Config:
        from_attributes = True


class ProductResponse(BaseModel):
    id: int
    name: str
    description: str
    category: str
    price: Optional[float]
    currency: str
    status: str
    metadata_json: str
    created_at: str
    files: List[ProductFileResponse] = []

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────
def _save_file(upload: UploadFile, subfolder: str) -> tuple[str, str]:
    """Save an uploaded file and return (file_path, file_type)."""
    ext = os.path.splitext(upload.filename or "file")[1]
    unique_name = f"{uuid.uuid4().hex}{ext}"
    dest_dir = os.path.join(UPLOAD_DIR, subfolder)
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, unique_name)

    with open(dest_path, "wb") as f:
        shutil.copyfileobj(upload.file, f)

    content_type = upload.content_type or ""
    if content_type in ALLOWED_IMAGE_TYPES:
        file_type = "image"
    elif content_type in ALLOWED_DOC_TYPES:
        file_type = "pdf"
    else:
        file_type = "document"

    return dest_path.replace("\\", "/"), file_type


# ── Routes ────────────────────────────────────────────
@router.get("/", response_model=List[ProductResponse])
def list_products(
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    q = db.query(Product).options(joinedload(Product.files))
    if category:
        q = q.filter(Product.category == category)
    if status:
        q = q.filter(Product.status == status)
    if search:
        q = q.filter(Product.name.ilike(f"%{search}%"))
    products = q.order_by(Product.created_at.desc()).all()
    result = []
    for p in products:
        d = {
            "id": p.id, "name": p.name, "description": p.description,
            "category": p.category, "price": p.price, "currency": p.currency,
            "status": p.status, "metadata_json": p.metadata_json,
            "created_at": p.created_at.isoformat() if p.created_at else "",
            "files": [{"id": f.id, "file_type": f.file_type, "file_path": f.file_path,
                        "original_name": f.original_name, "display_order": f.display_order} for f in p.files]
        }
        result.append(d)
    return result


@router.get("/{product_id}", response_model=ProductResponse)
def get_product(product_id: int, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    product = db.query(Product).options(joinedload(Product.files)).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return {
        "id": product.id, "name": product.name, "description": product.description,
        "category": product.category, "price": product.price, "currency": product.currency,
        "status": product.status, "metadata_json": product.metadata_json,
        "created_at": product.created_at.isoformat() if product.created_at else "",
        "files": [{"id": f.id, "file_type": f.file_type, "file_path": f.file_path,
                    "original_name": f.original_name, "display_order": f.display_order} for f in product.files]
    }


@router.post("/", response_model=ProductResponse, status_code=201)
async def create_product(
    name: str = Form(...),
    description: str = Form(""),
    category: str = Form("General"),
    price: Optional[float] = Form(None),
    currency: str = Form("USD"),
    metadata_json: str = Form("{}"),
    files: List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    product = Product(
        name=name, description=description, category=category,
        price=price, currency=currency, metadata_json=metadata_json,
    )
    db.add(product)
    db.commit()
    db.refresh(product)

    saved_files = []
    for i, upload in enumerate(files):
        path, ftype = _save_file(upload, f"products/{product.id}")
        pf = ProductFile(
            product_id=product.id,
            file_type=ftype,
            file_path=path,
            original_name=upload.filename or "",
            display_order=i,
        )
        db.add(pf)
        saved_files.append(pf)

    db.commit()
    for pf in saved_files:
        db.refresh(pf)

    return {
        "id": product.id, "name": product.name, "description": product.description,
        "category": product.category, "price": product.price, "currency": product.currency,
        "status": product.status, "metadata_json": product.metadata_json,
        "created_at": product.created_at.isoformat() if product.created_at else "",
        "files": [{"id": f.id, "file_type": f.file_type, "file_path": f.file_path,
                    "original_name": f.original_name, "display_order": f.display_order} for f in saved_files]
    }


@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: int,
    name: str = Form(None),
    description: str = Form(None),
    category: str = Form(None),
    price: Optional[float] = Form(None),
    currency: str = Form(None),
    status: str = Form(None),
    metadata_json: str = Form(None),
    new_files: List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    _admin=Depends(require_admin),
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    if name is not None:
        product.name = name
    if description is not None:
        product.description = description
    if category is not None:
        product.category = category
    if price is not None:
        product.price = price
    if currency is not None:
        product.currency = currency
    if status is not None:
        product.status = status
    if metadata_json is not None:
        product.metadata_json = metadata_json

    for upload in new_files:
        path, ftype = _save_file(upload, f"products/{product.id}")
        pf = ProductFile(
            product_id=product.id,
            file_type=ftype,
            file_path=path,
            original_name=upload.filename or "",
            display_order=len(product.files),
        )
        db.add(pf)

    db.commit()
    db.refresh(product)

    return {
        "id": product.id, "name": product.name, "description": product.description,
        "category": product.category, "price": product.price, "currency": product.currency,
        "status": product.status, "metadata_json": product.metadata_json,
        "created_at": product.created_at.isoformat() if product.created_at else "",
        "files": [{"id": f.id, "file_type": f.file_type, "file_path": f.file_path,
                    "original_name": f.original_name, "display_order": f.display_order} for f in product.files]
    }


@router.delete("/{product_id}", status_code=204)
def delete_product(product_id: int, db: Session = Depends(get_db), _admin=Depends(require_admin)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Clean up files from disk
    product_dir = os.path.join(UPLOAD_DIR, f"products/{product_id}")
    if os.path.exists(product_dir):
        shutil.rmtree(product_dir)

    db.delete(product)
    db.commit()


@router.delete("/{product_id}/files/{file_id}", status_code=204)
def delete_product_file(
    product_id: int, file_id: int,
    db: Session = Depends(get_db), _admin=Depends(require_admin),
):
    pf = db.query(ProductFile).filter(
        ProductFile.id == file_id, ProductFile.product_id == product_id
    ).first()
    if not pf:
        raise HTTPException(status_code=404, detail="File not found")

    if os.path.exists(pf.file_path):
        os.remove(pf.file_path)

    db.delete(pf)
    db.commit()

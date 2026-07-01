import React, { useState, useEffect, useRef } from 'react';

const AvatarCropperModal = ({ imageFile, onCancel, onSave }) => {
  const [src, setSrc] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dim, setDim] = useState({ w: 256, h: 256 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const imgRef = useRef(null);

  useEffect(() => {
      const url = URL.createObjectURL(imageFile);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const handleImageLoad = (e) => {
      const nw = e.target.naturalWidth;
      const nh = e.target.naturalHeight;
      const scaleBase = Math.max(256 / nw, 256 / nh);
      setDim({ w: nw * scaleBase, h: nh * scaleBase });
  };

  const handleStart = (clientX, clientY) => {
      setIsDragging(true);
      dragStart.current = { x: clientX - pos.x, y: clientY - pos.y };
  };

  const handleMove = (clientX, clientY) => {
      if (!isDragging) return;
      setPos({ x: clientX - dragStart.current.x, y: clientY - dragStart.current.y });
  };

  const handleEnd = () => setIsDragging(false);

  const generateCrop = () => {
      if (!imgRef.current) return;
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      
      const img = imgRef.current;
      const rw = dim.w;
      const rh = dim.h;

      ctx.clearRect(0, 0, 256, 256);
      // Enforce strict circular clipping
      ctx.beginPath();
      ctx.arc(128, 128, 128, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      
      ctx.translate(128, 128);
      ctx.scale(zoom, zoom);
      ctx.translate(pos.x, pos.y);
      ctx.drawImage(img, -rw / 2, -rh / 2, rw, rh);

      canvas.toBlob((blob) => {
          onSave(blob);
      }, 'image/png');
  };

  return (
      <div className="cropper-overlay">
          <div className="cropper-card">
              <h3>Adjust Profile Picture</h3>
              <div 
                  className="cropper-viewport"
                  onMouseDown={e => handleStart(e.clientX, e.clientY)}
                  onMouseMove={e => handleMove(e.clientX, e.clientY)}
                  onMouseUp={handleEnd}
                  onMouseLeave={handleEnd}
                  onTouchStart={e => handleStart(e.touches[0].clientX, e.touches[0].clientY)}
                  onTouchMove={e => handleMove(e.touches[0].clientX, e.touches[0].clientY)}
                  onTouchEnd={handleEnd}
              >
                  <img 
                      ref={imgRef}
                      src={src} 
                      draggable={false}
                      onLoad={handleImageLoad}
                      style={{
                          width: `${dim.w}px`,
                          height: `${dim.h}px`,
                          transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) scale(${zoom})`
                      }}
                      className="cropper-image"
                      alt="Crop Source"
                  />
                  <div className="cropper-mask"></div>
              </div>
              <div className="cropper-controls">
                  <i className="fas fa-search-minus"></i>
                  <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={e => setZoom(parseFloat(e.target.value))} />
                  <i className="fas fa-search-plus"></i>
              </div>
              <div className="cropper-actions">
                  <button className="btn-crop-cancel" onClick={onCancel}>Cancel</button>
                  <button className="btn-crop-save" onClick={generateCrop}>Apply</button>
              </div>
          </div>
      </div>
  );
};

export default AvatarCropperModal;
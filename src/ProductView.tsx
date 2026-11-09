import { useRef, useState } from "react";

interface Props {
  projectName: string;
  image?: string;
  onImageChange: (image?: string) => void;
  focusMode?: boolean;
  onExitFocusMode?: () => void;
}

export function ProductView({ projectName, image, onImageChange, focusMode = false, onExitFocusMode }: Props) {
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string>();

  const uploadImage = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("Please choose an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onImageChange(reader.result);
        setImageError(undefined);
      }
    };
    reader.onerror = () => setImageError("The image could not be read.");
    reader.readAsDataURL(file);
  };

  return (
    <section className="product-view" aria-labelledby="product-view-title">
      <header>
        <p className="eyebrow">{focusMode ? "Game view · Product" : "Product view"}</p>
        <div className="product-header-row">
          <h2 id="product-view-title">Product & system architecture</h2>
          <div className="product-header-actions">
            {!focusMode && <div className="product-upload-controls">
              <input ref={imageInput} className="visually-hidden" type="file" accept="image/*" onChange={(event) => {
                uploadImage(event.target.files?.[0]);
                event.currentTarget.value = "";
              }} />
              <button type="button" className="secondary-button" onClick={() => imageInput.current?.click()}>{image ? "Change image" : "Upload image"}</button>
              {image && <button type="button" className="secondary-button" onClick={() => onImageChange(undefined)}>Remove image</button>}
            </div>}
            {focusMode && <button type="button" className="focus-exit-button" onClick={onExitFocusMode}>Exit game view <kbd>Esc</kbd></button>}
          </div>
        </div>
        {!focusMode && <p>Upload a product, architecture, or current product-increment image. It is also available in Game view.</p>}
      </header>

      {imageError && <p className="settings-error" role="alert">{imageError}</p>}
      <div className="product-content">
        <section className="product-architecture" aria-labelledby="product-architecture-title">
          <div className="product-section-heading">
            <p className="eyebrow">Product & system architecture</p>
            <h3 id="product-architecture-title">{projectName.trim() || "Product"}</h3>
          </div>
          {image ? <img className="product-image" src={image} alt="Uploaded product and system architecture" /> : <div className="product-image-empty"><strong>No product image yet</strong><span>Upload an image to give the participants a shared product and architecture reference.</span></div>}
        </section>
      </div>
    </section>
  );
}

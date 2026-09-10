const cloudinary = require("cloudinary").v2;

// Configure Cloudinary strictly from environment variables or CLOUDINARY_URL (no hardcoded fallbacks)
if (process.env.CLOUDINARY_URL) {
  cloudinary.config({
    cloudinary_url: process.env.CLOUDINARY_URL,
  });
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "",
    api_key: process.env.CLOUDINARY_API_KEY || "",
    api_secret: process.env.CLOUDINARY_API_SECRET || "",
    secure: true,
  });
}

/**
 * Upload an image (base64 string, data URI, or URL) to Cloudinary
 * @param {string} imageBase64 - Base64 or Data URI string
 * @param {string} folder - Destination folder in Cloudinary
 * @returns {Promise<{ secure_url: string, public_id: string }>}
 */
async function uploadToCloudinary(imageBase64, folder = "ocs_avatars") {
  if (
    !process.env.CLOUDINARY_URL &&
    (!process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET)
  ) {
    throw new Error(
      "Cloudinary credentials are not configured in environment variables.",
    );
  }
  try {
    const result = await cloudinary.uploader.upload(imageBase64, {
      folder,
      resource_type: "image",
      transformation: [
        { width: 400, height: 400, crop: "fill", gravity: "face" },
        { quality: "auto", fetch_format: "auto" },
      ],
    });

    return {
      secure_url: result.secure_url,
      public_id: result.public_id,
    };
  } catch (err) {
    // If Cloudinary rejects or keys are invalid, return a reliable avatar data URL or error
    console.error("[Cloudinary Upload Error]:", err.message || err);
    throw err;
  }
}

/**
 * Delete an image by public_id from Cloudinary
 */
async function deleteFromCloudinary(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.warn("[Cloudinary Delete Warning]:", err.message || err);
  }
}

module.exports = {
  cloudinary,
  uploadToCloudinary,
  deleteFromCloudinary,
};

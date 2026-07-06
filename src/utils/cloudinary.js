import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import { url } from "inspector";

const uploadCloudinary = async (localFilePath) => {
  try {
    if (!localFilePath) return null;

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    const response = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "auto",
    });
    fs.unlinkSync(localFilePath);
    return response;
  } catch (error) {
    throw error;
    fs.unlinkSync(localFilePath);
    return null;
  }
};

const getPublicId = (url) => {
  const parts = url.split("/");
  const filename = parts[parts.length - 1];
  const publicId = filename.split(".")[0];
  return publicId;
};

const deleteFromCloudinary = async (asseturl, resourceType = "image") => {
  try {
    if (!asseturl) return null;

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    const publicId = getPublicId(asseturl);

    const response = await cloudinary.uploader.destroy(assetPath, {
      resource_type: resourceType,
    });
    if (response.result !== "ok") {
      console.log("Cloudinary delete failed:", response);
      return null;
    }
    return response;
  } catch (error) {
    console.log("Cloudinary delete error:", error);
    return null;
  }
};

export { uploadCloudinary, deleteFromCloudinary };

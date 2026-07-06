import mongoose, { isValidObjectId, mongo } from "mongoose";
import { Video } from "../models/video.model.js";
import { User } from "../models/user.model.js";
import { Like } from "../models/like.models.js";
import { Comment } from "../models/comment.models.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  uploadCloudinary,
  deletleFromCloudinary,
} from "../utils/cloudinary.js";
import { deserialize, ReturnDocument } from "mongodb";

const getAllVideos = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, query, sortBy, sortType, userId } = req.query;
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const sortOrder = sortType === "asc" ? 1 : -1;
  const skip = (pageNum - 1) * limitNum;

  const matchConditions = { isPublished: true };

  if (query) {
    matchConditions.$or = [
      { title: { $regex: query, $options: "i" } },
      { description: { $regex: query, $options: "i" } },
    ];
  }

  if (userId) {
    if (!isValidObjectId(userId)) {
      throw new ApiError(400, "Invalid userId");
    }
    matchConditions.owner = new mongoose.Types.ObjectId(userId);
  }

  const pipeline = [
    { $match: matchConditions },
    { $sort: { [sortBy]: sortOrder } },
    { $skip: skip },
    { $limit: limitNum },
    {
      $lookup: {
        from: "users",
        localField: "owner",
        foreignField: "_id",
        as: "owner",
        pipeline: [
          {
            $project: { username: 1, fullName: 1, avatar: 1 },
          },
        ],
      },
    },
    {
      $addFields: {
        owner: { $first: "$owner" },
      },
    },
    {
      $project: {
        title: 1,
        description: 1,
        thumbnail: 1,
        videoFile: 1,
        duration: 1,
        views: 1,
        isPublished: 1,
        owner: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  ];

  const totalVideos = await Video.countDocuments(matchConditions);

  const videos = await Video.aggregate(pipeline);

  if (!videos || videos.length === 0) {
    throw new ApiError(404, "No videos found");
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        videos,
        pagination: {
          totalVideos,
          totalPages: Math.ceil(totalVideos / limitNum),
          currentPage: pageNum,
          limit: limitNum,
          hasNextPage: page < Math.ceil(totalVideos / limitNum),
          hasPrevPage: pageNum > 1,
        },
      },
      "Videos fetched successfully"
    )
  );
});

const publishAVideo = asyncHandler(async (req, res) => {
  const { title, description } = req.body;
  if (
    !title ||
    !description ||
    title.trim() === "" ||
    description.trim() === ""
  ) {
    throw new ApiError(400, "Title and description are required");
  }

  const videoLocalPath = req.files?.videoFile?.[0]?.path;
  if (!videoLocalPath) {
    throw new ApiError(400, "Video file is required");
  }
  const thumbnailLocalPath = req.files?.thumbnail?.[0]?.path;
  if (!thumbnailLocalPath) {
    throw new ApiError(400, "Thumbnail file is required");
  }

  const videoFile = await uploadCloudinary(videoLocalPath);
  if (!videoFile) {
    throw new ApiError(500, "Video upload failed");
  }
  const thumbnail = await uploadCloudinary(thumbnailLocalPath);
  if (!thumbnail) {
    throw new ApiError(500, "Thumbnail upload failed");
  }

  const video = await Video.create({
    title,
    description,
    videoFile: videoFile.url,
    thumbnail: thumbnail.url,
    duration: videoFile.duration,
    owner: req.user._id,
    isPublished: true,
  });

  if (!video) {
    throw new ApiError(500, "Something went wrong while publishing");
  }

  return res
    .status(201)
    .json(new ApiResponse(201, video, "Video published successfully"));
});

const getVideoById = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  if (!isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid videoId");
  }

  const pipeline = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(videoId),
        isPublished: true,
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "owner",
        foreignField: "_id",
        as: "owner",
        pipeline: [
          {
            $lookup: {
              from: "subscriptions",
              localField: "_id",
              foreignField: "channel",
              as: "subscribers",
            },
          },
          {
            $addFields: {
              subscribersCount: { $size: "$subscribers" },
              isSubscribed: {
                $cond: {
                  if: { $in: [req.user?._id, "$subscribers.subscriber"] },
                  then: true,
                  else: false,
                },
              },
            },
          },
          {
            $project: {
              username: 1,
              fullName: 1,
              avatar: 1,
              subscribersCount: 1,
              isSubscribed: 1,
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: "likes",
        localField: "_id",
        foreignField: "video",
        as: "likes",
      },
    },
    {
      $addFields: {
        owner: { $first: "$owner" },
        likesCount: { $size: "$likes" },
        isliked: {
          $cond: {
            if: {
              $in: [req.user?._id, "$likes.likedBy"],
              then: true,
              else: false,
            },
          },
        },
      },
    },
    {
      $project: {
        title: 1,
        description: 1,
        videoFile: 1,
        thumbnail: 1,
        duration: 1,
        views: 1,
        isPublished: 1,
        createdAt: 1,
        owner: 1,
        likesCount: 1,
        isliked: 1,
      },
    },
  ];

  const video = await Video.aggregate(pipeline);

  if (!video || video.length === 0) {
    throw new ApiError(404, "Video not found");
  }

  await Video.findByIdAndUpdate(videoId, {
    $inc: { views: 1 },
  });

  await User.findByIdAndUpdate(req.user._id, {
    $addToSet: { watchHistory: videoId },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, video[0], "Video fetched successfully"));
});

const updateVideo = asyncHandler(async (req, res) => {
  const { videoId } = req.params;
  if (!isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid videoId");
  }
  const { tittle, description } = req.body;
  const thumbnailLocalPath = req.file?.path;

  if (!tittle && !description && !thumbnailLocalPath) {
    throw new ApiError(400, "At least one field is required to update");
  }

  const video = await Video.findById(videoId);

  if (!video) {
    throw new ApiError(404, "Video not found");
  }

  if (video.owner.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You are not allowed to update this video");
  }

  if (thumbnailLocalPath) {
    const newThumbnail = await uploadCloudinary(thumbnailLocalPath);
    if (!newThumbnail) {
      throw new ApiError(500, "Thumbnail upload failed");
    }

    await deletleFromCloudinary(video.thumbnail, "image");
  }

  const updateFields = {};

  if (tittle) updateFields.title = tittle;
  if (description) updateFields.description = description;
  if (newThumbnail) updateFields.thumbnail = newThumbnail.url;

  const updatedVideo = await Video.findByIdAndUpdate(
    videoId,
    {
      $set: updateFields,
    },
    { returnDocument: "after" }
  );

  if (!updatedVideo) {
    throw new ApiError(500, "something went wrong while updating");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, updatedVideo, "Video updated successfully"));
});

const deleteVideo = asyncHandler(async (req, res) => {
  const { videoId } = req.params;

  if (!isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid videoId");
  }

  const video = await Video.findById(videoId);

  if (!video) {
    throw new ApiError(404, "Video not found");
  }

  if (video.owner.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "You are not allowed to delete this video");
  }

  await deletleFromCloudinary(video.videoFile, "video");
  await deletleFromCloudinary(video.thumbnail, "image");

  await Video.findByIdAndDelete(videoId);

  await Like.deleteMany({ video: videoId });
  await Comment.deleteMany({ video: videoId });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Video deleted successfully"));
});

//NOTE:check before running this toggle
const togglePublishStatus = asyncHandler(async (req, res) => {
  const { videoId } = req.params;

  if (!isValidObjectId(videoId)) {
    throw new ApiError(400, "Invalid videoId");
  }

  const video = await Video.findById(videoId);

  if (!video) {
    throw new ApiError(404, "Video not found");
  }

  if (video.owner.toString() !== req.user._id.toString()) {
    throw new ApiError(
      403,
      "You are not allowed  to change Publish status of this video"
    );
  }

  const publishedStatus = video.isPublished ? true : false;

  await Video.findByIdAndUpdate(
    videoId,
    { $set: publishedStatus },
    { returnDocument: "after" }
  );

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Publish status toggled successfully"));
});

export {
  getAllVideos,
  publishAVideo,
  getVideoById,
  updateVideo,
  deleteVideo,
  togglePublishStatus,
};

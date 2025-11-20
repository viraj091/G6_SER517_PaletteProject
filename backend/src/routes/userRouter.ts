import express from "express";
import {
  getUserSettings,
  updateUserCourseFilters,
  updateUserCourseFilterPresets,
  updateUserSettings,
  updateUserAssignmentFilterPresets,
  updateUserAssignmentFilters,
  canvasLogin,
} from "../controllers/userController.js";
import { validationErrorHandler } from "../middleware/validationErrorHandler.js";
import { updateUserSettingsValidator } from "../validators/updateUserSettingsValidator.js";

const userRouter = express.Router();

/**
 * @swagger
 * /user/settings:
 *   get:
 *     summary: Get user settings
 *     description: Retrieve the settings for the currently authenticated user.
 *     responses:
 *       200:
 *         description: Successfully retrieved user settings.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 darkMode:
 *                   type: boolean
 *                   example: true
 *                 notifications:
 *                   type: boolean
 *                   example: false
 *       401:
 *         description: Get the settings for the current user.
 * @route GET /user/settings
 * @description Get the settings for the current user.
 */
userRouter.get("/settings", getUserSettings);

/**
 * @swagger
 * /user/settings:
 *   put:
 *     summary: Update user settings
 *     description: Modify the settings for the current user.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               darkMode:
 *                 type: boolean
 *                 description: Enable or disable dark mode.
 *                 example: true
 *               notifications:
 *                 type: boolean
 *                 description: Enable or disable notifications.
 *                 example: false
 *     responses:
 *       200:
 *         description: Settings updated successfully.
 *       400:
 *         description: Validation error in request body.
 *       401:
 *         description: Unauthorized. User authentication required.
 * @route PUT /user/settings
 */
userRouter.put(
  "/settings",
  updateUserSettingsValidator,
  validationErrorHandler,
  updateUserSettings,
);

userRouter.put(
  "/settings/course_filters",
  validationErrorHandler,
  updateUserCourseFilters,
);

userRouter.put(
  "/settings/course_filter_presets",
  validationErrorHandler,
  updateUserCourseFilterPresets,
);

userRouter.put(
  "/settings/assignment_filters",
  validationErrorHandler,
  updateUserAssignmentFilters,
);

userRouter.put(
  "/settings/assignment_filter_presets",
  validationErrorHandler,
  updateUserAssignmentFilterPresets,
);

/**
 * @swagger
 * /user/canvas-login:
 *   post:
 *     summary: Initiate Canvas login
 *     description: Opens a browser-based login window to authenticate with Canvas. Captures and stores cookies for API access.
 *     responses:
 *       200:
 *         description: Canvas login successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     authenticated:
 *                       type: boolean
 *                       example: true
 *                 message:
 *                   type: string
 *                   example: Canvas login successful
 *       500:
 *         description: Canvas login failed.
 * @route POST /user/canvas-login
 */
userRouter.post("/canvas-login", canvasLogin);

export default userRouter;

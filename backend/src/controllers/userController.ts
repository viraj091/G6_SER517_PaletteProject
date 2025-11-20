import { Request, Response } from "express";
import asyncHandler from "express-async-handler";
import { createSuccessResponse } from "../utils/paletteResponseFactories.js";
import { Settings } from "palette-types";
import { SettingsAPI } from "../settings.js";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { StatusCodes } from "http-status-codes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Handles the GET request to retrieve a user's settings.
 *
 * @param {Request} req - The Express request object (not used in this handler).
 * @param {Response} res - The Express response object.
 * @returns {Promise<void>} - A promise that resolves to void.
 */
export const getUserSettings = asyncHandler((req: Request, res: Response) => {
  // Get the settings object
  const settings: Settings = SettingsAPI.getUserSettings();

  // Send the settings object as a response
  res.json(createSuccessResponse(settings));
});

export const updateUserSettings = asyncHandler(
  (req: Request, res: Response) => {
    // Update the settings with the new values
    SettingsAPI.updateUserSettings(req.body as Settings);

    // Safely retrieve the updated settings
    const updatedSettings = SettingsAPI.getUserSettings();

    res.json(
      createSuccessResponse(updatedSettings, "Settings updated successfully"),
    );
  },
);

export const updateUserCourseFilters = asyncHandler(
  (req: Request, res: Response) => {
    SettingsAPI.updateUserCourseFilters(
      req.body as { id: string; option: string; param_code: string }[],
    );

    // Safely retrieve the updated settings
    const updatedSettings = SettingsAPI.getUserSettings();

    res.json(
      createSuccessResponse(
        updatedSettings,
        "Course filters updated successfully",
      ),
    );
  },
);

export const updateUserCourseFilterPresets = asyncHandler(
  (req: Request, res: Response) => {
    SettingsAPI.updateUserCourseFilterPresets(
      req.body as {
        name: string;
        filters: { option: string; param_code: string }[];
      }[],
    );

    // Safely retrieve the updated settings
    const updatedSettings = SettingsAPI.getUserSettings();

    res.json(
      createSuccessResponse(
        updatedSettings,
        "Course filter presets updated successfully",
      ),
    );
  },
);

export const updateUserAssignmentFilters = asyncHandler(
  (req: Request, res: Response) => {
    SettingsAPI.updateUserAssignmentFilters(
      req.body as {
        id: string;
        option: string;
        param_code: string;
      }[],
    );

    // Safely retrieve the updated settings
    const updatedSettings = SettingsAPI.getUserSettings();

    res.json(
      createSuccessResponse(
        updatedSettings,
        "Assignment filters updated successfully",
      ),
    );
  },
);

export const updateUserAssignmentFilterPresets = asyncHandler(
  (req: Request, res: Response) => {
    SettingsAPI.updateUserAssignmentFilterPresets(
      req.body as {
        id: string;
        name: string;
        filters: { option: string; param_code: string }[];
      }[],
    );

    // Safely retrieve the updated settings
    const updatedSettings = SettingsAPI.getUserSettings();

    res.json(
      createSuccessResponse(
        updatedSettings,
        "Assignment filter presets updated successfully",
      ),
    );
  },
);

export const canvasLogin = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      // Path to the Python login script
      const pythonScriptPath = path.join(
        __dirname,
        "..",
        "python",
        "canvas_login.py",
      );

      // Spawn Python process
      const pythonProcess = spawn("python", [pythonScriptPath]);

      let stdout = "";
      let stderr = "";

      // Collect stdout
      pythonProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      // Collect stderr
      pythonProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      // Handle process completion
      pythonProcess.on("close", (code) => {
        if (code === 0) {
          try {
            // Parse the JSON output from Python
            const result = JSON.parse(stdout);

            if (result.success && result.cookies) {
              // Update cookies in settings
              SettingsAPI.updateCanvasCookies(result.cookies);

              res.json(
                createSuccessResponse(
                  { authenticated: true },
                  "Canvas login successful",
                ),
              );
            } else {
              res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
                success: false,
                message: "Canvas login failed",
                error: result.error || "Unknown error",
              });
            }
          } catch (parseError) {
            res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
              success: false,
              message: "Failed to parse login response",
              error: String(parseError),
            });
          }
        } else {
          // Python process failed
          res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: "Canvas login process failed",
            error: stderr || "Unknown error",
          });
        }
      });

      // Handle process error
      pythonProcess.on("error", (error) => {
        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: "Failed to start Canvas login process",
          error: error.message,
        });
      });
    } catch (error) {
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: "Canvas login failed",
        error: String(error),
      });
    }
  },
);

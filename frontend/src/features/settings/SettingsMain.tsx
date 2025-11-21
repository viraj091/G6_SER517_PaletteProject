import { ReactElement, useState } from "react";
import {
  ChoiceDialog,
  Footer,
  Header,
  LoadingDots,
  PaletteActionButton,
} from "@/components";
import { useFetch } from "@/hooks";
import { useChoiceDialog, useSettings } from "@/context";

export function SettingsMain(): ReactElement {
  const { settings, setSettings, error } = useSettings();
  const [loading, setLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  const { fetchData: updateSettings } = useFetch("/user/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });

  const { fetchData: canvasLogin } = useFetch("/user/canvas-login", {
    method: "POST",
  });

  const { openDialog, closeDialog } = useChoiceDialog();

  const TEXT_INPUT_STYLE =
    "w-full p-3 rounded bg-gray-700 text-white focus:outline-none focus:ring-2" +
    " focus:ring-blue-500";

  /**
   * Handles input change for settings fields.
   *
   * @param {string} field - The field name to update.
   * @param {unknown} value - The new value for the field.
   */
  const handleInputChange = (field: string, value: unknown) => {
    if (settings) {
      setSettings({ ...settings, [field]: value });
    }
  };

  /**
   * Handles input change for preference fields.
   *
   * @param {string} field - The preference field name to update.
   * @param {unknown} value - The new value for the preference field.
   */
  const handlePreferenceChange = (field: string, value: unknown) => {
    if (settings) {
      setSettings({
        ...settings,
        preferences: { ...settings.preferences, [field]: value },
      });
    }
  };

  /**
   * Handles saving the updated settings.
   */
  const handleSave = async () => {
    setLoading(true);
    try {
      const response = await updateSettings();
      if (response.success) {
        openDialog({
          title: "Success",
          message: "Settings updated successfully!",
          buttons: [
            { label: "Nice!", action: () => closeDialog(), autoFocus: true },
          ],
        });
      } else {
        openDialog({
          title: "Error",
          message: response.error || "Failed to save settings.",
          buttons: [
            {
              label: "Got It",
              action: () => closeDialog(),
              autoFocus: true,
              color: "RED",
            },
          ],
        });
      }
    } catch (error) {
      console.error(error);
      openDialog({
        title: "Error",
        message: "An error occurred while saving settings.",
        buttons: [
          {
            label: "Got It",
            action: () => closeDialog(),
            autoFocus: true,
            color: "RED",
          },
        ],
      });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handles Canvas login via browser-based authentication.
   */
  const handleCanvasLogin = async () => {
    setLoginLoading(true);
    try {
      openDialog({
        title: "Canvas Login",
        message:
          "A browser window will open for Canvas login. Please log in and the window will close automatically.",
        buttons: [
          { label: "OK", action: () => closeDialog(), autoFocus: true },
        ],
      });

      const response = await canvasLogin();

      if (response.success) {
        // Reload settings to get the updated cookies
        window.location.reload();

        openDialog({
          title: "Success",
          message: "Canvas login successful! You are now authenticated.",
          buttons: [
            { label: "Great!", action: () => closeDialog(), autoFocus: true },
          ],
        });
      } else {
        openDialog({
          title: "Error",
          message: response.error || "Canvas login failed.",
          buttons: [
            {
              label: "Got It",
              action: () => closeDialog(),
              autoFocus: true,
              color: "RED",
            },
          ],
        });
      }
    } catch (error) {
      console.error(error);
      openDialog({
        title: "Error",
        message: "An error occurred during Canvas login.",
        buttons: [
          {
            label: "Got It",
            action: () => closeDialog(),
            autoFocus: true,
            color: "RED",
          },
        ],
      });
    } finally {
      setLoginLoading(false);
    }
  };

  /**
   * Renders the content of the settings page.
   *
   * @returns {ReactElement} The rendered content.
   */
  const renderContent = (): ReactElement => {
    if (loading) return <LoadingDots />;
    if (error) return <p className="text-red-500 text-center">{error}</p>;
    if (!settings) return <p className="text-center">No settings available</p>;

    return (
      <form
        className="h-full self-center grid p-10 w-full max-w-3xl my-6 gap-6 bg-gray-800 shadow-lg rounded-lg"
        onSubmit={(e) => e.preventDefault()}
      >
        <h1 className="font-extrabold text-5xl mb-2 text-center">
          User Settings
        </h1>
        {/* User Name */}
        <div>
          <label className="block font-bold text-gray-400 mb-2">
            User Name
          </label>
          <input
            type="text"
            className={TEXT_INPUT_STYLE}
            value={settings.userName}
            onChange={(e) => handleInputChange("userName", e.target.value)}
          />
          {/* Token */}
          <label className="block font-bold text-gray-400 mt-4 mb-2">
            Token Input (Optional - use Canvas Login instead)
          </label>
          <input
            type="password"
            className={TEXT_INPUT_STYLE}
            value={settings.token}
            onChange={(e) => handleInputChange("token", e.target.value)}
          />

          {/* Canvas Login Section */}
          <div className="mt-4">
            <label className="block font-bold text-gray-400 mb-2">
              Canvas Authentication Status
            </label>
            {(() => {
              const cookies = (settings.cookies ?? {}) as Record<
                string,
                string
              >;
              const cookieCount = Object.keys(cookies).length;
              return cookieCount > 0 ? (
                <div className="bg-green-900 border border-green-600 rounded p-3 mb-3">
                  <p className="text-green-200 flex items-center gap-2">
                    <span className="text-2xl">✓</span>
                    <span>
                      Successfully authenticated with Canvas via browser login
                    </span>
                  </p>
                  <p className="text-sm text-green-300 mt-1">
                    {cookieCount} cookies stored
                  </p>
                </div>
              ) : (
                <div className="bg-yellow-900 border border-yellow-600 rounded p-3 mb-3">
                  <p className="text-yellow-200 flex items-center gap-2">
                    <span className="text-2xl">⚠</span>
                    <span>Not authenticated via Canvas login</span>
                  </p>
                  <p className="text-sm text-yellow-300 mt-1">
                    Use the button below to log in with your Canvas credentials
                  </p>
                </div>
              );
            })()}

            <PaletteActionButton
              title={
                loginLoading ? "Opening Canvas Login..." : "Login to Canvas"
              }
              onClick={() => void handleCanvasLogin()}
              color={"GREEN"}
              disabled={loginLoading}
            />
            <p className="text-sm text-gray-400 mt-2">
              Browser-based authentication. Window will close automatically
              after login.
            </p>
          </div>
        </div>
        {/* Preferences */}
        <div className={"grid gap-2"}>
          <h2 className="block font-bold text-gray-400">Preferences</h2>
          <div className="flex gap-4 items-center">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.preferences.darkMode}
                onChange={(e) =>
                  handlePreferenceChange("darkMode", e.target.checked)
                }
              />
              <span className="text-white">Dark Mode</span>
            </label>
          </div>
          {/* Default Ratings */}
          <div>
            <h2 className="block font-bold text-gray-400">Default Ratings</h2>

            <div className={"grid gap-1 "}>
              <div className={"grid items-center gap-2"}>
                <div className={"flex items-center gap-2 mt-2"}>
                  <label className={""}> Max Points</label>
                  <input
                    type="number"
                    className={`${TEXT_INPUT_STYLE} w-min`}
                    min={1} // ensure max is always greater than 0
                    max={99}
                    value={settings.preferences.defaultRatings.maxDefaultPoints}
                    placeholder={""}
                    onChange={(event) => {
                      setSettings((prevState) => {
                        const newValue = Number(event.target.value);
                        return {
                          ...prevState,
                          preferences: {
                            ...prevState.preferences,
                            defaultRatings: {
                              ...prevState.preferences.defaultRatings,
                              maxDefaultPoints: isNaN(newValue) ? 0 : newValue,
                            },
                          },
                        };
                      });
                    }}
                  />
                </div>

                <label className={"row-start-2 text-nowrap"}>
                  {" "}
                  Max Rating Description
                </label>
                <textarea
                  className={`${TEXT_INPUT_STYLE} row-start-3 col-span-4`}
                  value={
                    settings.preferences.defaultRatings.maxDefaultDescription
                  }
                  onChange={(event) => {
                    setSettings((prevState) => {
                      return {
                        ...prevState,
                        preferences: {
                          ...prevState.preferences,
                          defaultRatings: {
                            ...prevState.preferences.defaultRatings,
                            maxDefaultDescription: event.target.value,
                          },
                        },
                      };
                    });
                  }}
                />
              </div>
              <div className={"grid items-center gap-2"}>
                <div className={"flex items-center gap-2 mt-2"}>
                  <label className={""}> Min Points</label>
                  <input
                    type="number"
                    className={`${TEXT_INPUT_STYLE} w-min`}
                    min={0}
                    max={
                      settings.preferences.defaultRatings.maxDefaultPoints - 1
                    } // ensure min is less than or equal to the max
                    value={settings.preferences.defaultRatings.minDefaultPoints}
                    placeholder={""}
                    onChange={(event) => {
                      setSettings((prevState) => {
                        const newValue = Number(event.target.value);
                        return {
                          ...prevState,
                          preferences: {
                            ...prevState.preferences,
                            defaultRatings: {
                              ...prevState.preferences.defaultRatings,
                              minDefaultPoints: isNaN(newValue) ? 0 : newValue,
                            },
                          },
                        };
                      });
                    }}
                  />
                </div>

                <label className={"row-start-2 text-nowrap"}>
                  {" "}
                  Min Rating Description
                </label>
                <textarea
                  className={`${TEXT_INPUT_STYLE} row-start-3 col-span-4`}
                  value={
                    settings.preferences.defaultRatings.minDefaultDescription
                  }
                  onChange={(event) => {
                    setSettings((prevState) => {
                      return {
                        ...prevState,
                        preferences: {
                          ...prevState.preferences,
                          defaultRatings: {
                            ...prevState.preferences.defaultRatings,
                            minDefaultDescription: event.target.value,
                          },
                        },
                      };
                    });
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <PaletteActionButton
          title={"Update Settings"}
          onClick={() => void handleSave()}
          color={"BLUE"}
        />
      </form>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-700 text-white flex flex-col">
      <Header />
      <main className="flex-1 flex justify-center items-center p-6">
        {renderContent()}
      </main>
      <Footer />
      <ChoiceDialog />
    </div>
  );
}

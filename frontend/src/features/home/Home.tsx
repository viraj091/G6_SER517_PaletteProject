import { ReactElement, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Footer, Header, Dialog } from "@/components";
import { useFetch } from "@/hooks";
import { useChoiceDialog } from "@/context";
import Paint from "./Paint";

function hexToTailwindColor(hex: string): string {
  const colorMap: { [key: string]: string } = {
    "#ff0000": "bg-red-500",
    "#00ffc3": "bg-teal-400",
    "#0000ff": "bg-blue-700",
    "#ff00ff": "bg-pink-500",
    "#00ffff": "bg-cyan-200",
    "#ffa500": "bg-orange-500",
    "#db1ddb": "bg-purple-500",
    "#008000": "bg-green-600",
    "#ffff00": "bg-yellow-500",
    "#ff1493": "bg-pink-600",
  };

  return colorMap[hex];
}

export function Home(): ReactElement {
  const navigate = useNavigate();
  const [loginLoading, setLoginLoading] = useState(false);
  const [tokenLoginLoading, setTokenLoginLoading] = useState(false);
  const [showTokenDialog, setShowTokenDialog] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const { openDialog, closeDialog } = useChoiceDialog();

  const { fetchData: canvasLogin } = useFetch("/user/canvas-login", {
    method: "POST",
  });

  const { fetchData: tokenLogin } = useFetch<{ user: any }>("/settings/token", {
    method: "POST",
  });

  const blobColors = [
    "#ff0000", // red
    "#00ffc3", // teal
    "#0000ff", // blue
    "#ff00ff", // pink
    "#00ffff", // cyan
    "#ffa500", // orange
    "#db1ddb", // purple
    "#008000", // green
    "#ffff00", // yellow
    "#ff1493", // deep pink
  ];

  const cursorColor = blobColors[Math.floor(Math.random() * blobColors.length)];
  let paintColor = blobColors[Math.floor(Math.random() * blobColors.length)];

  // Ensure cursorColor and paintColor are not the same
  while (paintColor === cursorColor) {
    paintColor = blobColors[Math.floor(Math.random() * blobColors.length)];
  }

  console.log("cursorColor", cursorColor);
  console.log("paintColor", paintColor);
  console.log(
    "hexToTailwindColor(cursorColor)",
    hexToTailwindColor(cursorColor),
  );
  console.log("hexToTailwindColor(paintColor)", hexToTailwindColor(paintColor));

  const handleCanvasLogin = async () => {
    setLoginLoading(true);
    try {
      const response = await canvasLogin();

      if (response.success) {
        // Clear logout flag on successful login
        localStorage.removeItem("userLoggedOut");
        openDialog({
          title: "Success",
          message: "Canvas login successful! Redirecting to Palette...",
          buttons: [
            {
              label: "Continue",
              action: () => {
                closeDialog();
                navigate("/rubric-builder");
              },
              autoFocus: true,
            },
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

  const handleTokenLogin = () => {
    setShowTokenDialog(true);
  };

  const handleTokenSubmit = async () => {
    if (!tokenInput.trim()) {
      openDialog({
        title: "Error",
        message: "Please enter a valid Canvas personal access token.",
        buttons: [
          {
            label: "Got It",
            action: () => closeDialog(),
            autoFocus: true,
            color: "RED",
          },
        ],
      });
      return;
    }

    setTokenLoginLoading(true);
    try {
      const response = await fetch("http://localhost:3000/api/settings/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: tokenInput }),
      });

      const data = await response.json();

      if (data.success) {
        // Clear logout flag on successful login
        localStorage.removeItem("userLoggedOut");
        setShowTokenDialog(false);
        setTokenInput("");
        navigate("/rubric-builder");
      } else {
        openDialog({
          title: "Error",
          message: data.error || "Token login failed. Please check your token and try again.",
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
        message: "An error occurred during token login.",
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
      setTokenLoginLoading(false);
    }
  };

  return (
    <div className="h-screen w-full bg-gradient-to-br from-gray-800 via-gray-900 to-gray-700 flex flex-col justify-between">
      <Header />

      {/* Logo */}
      <Paint
        color={paintColor}
        cursorBallColor={cursorColor}
        cursorBallSize={2}
        ballCount={15}
        animationSize={30}
        enableMouseInteraction={true}
        hoverSmoothness={0.05}
        clumpFactor={1}
        speed={0.3}
      />
      {/* Main Content Section */}
      <div className="flex flex-col items-center justify-center text-white text-center -mt-44">
        {/* Title */}
        <h1 className="text-6xl font-bold mb-4 tracking-wide">
          Welcome to Palette
        </h1>

        {/* Subtitle */}
        <p className="text-xl text-gray-400 mb-8 max-w-lg mt-1">
          Improve the Canvas project grading experience with the perfect rubric.
        </p>

        {/* Login Options */}
        <div className="flex flex-col gap-4 w-full max-w-md">
          <button
            className={`${hexToTailwindColor(cursorColor)} text-white cursor-pointer rounded-lg px-8 py-4 font-semibold hover:opacity-80 transition duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed`}
            onClick={() => void handleCanvasLogin()}
            disabled={loginLoading}
          >
            {loginLoading ? "Opening Canvas Login..." : "Login Using Canvas"}
          </button>
          <button
            className="bg-gray-600 cursor-pointer text-white rounded-lg px-8 py-4 font-semibold hover:bg-gray-500 transition duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleTokenLogin}
            disabled={tokenLoginLoading}
          >
            Login Using Token
          </button>
          <p className="text-sm text-gray-400 text-center mt-2">
            Choose your preferred authentication method
          </p>
        </div>
      </div>
      <Footer />

      {/* Token Login Dialog */}
      <Dialog
        isOpen={showTokenDialog}
        onClose={() => {
          setShowTokenDialog(false);
          setTokenInput("");
          setTokenLoginLoading(false);
        }}
        title="Login with Canvas Personal Access Token"
      >
        <div className="space-y-4">
          <div className="bg-gray-600 p-4 rounded-lg">
            <h3 className="text-lg font-semibold mb-2 text-white">How to Generate a Canvas Access Token:</h3>
            <ol className="list-decimal list-inside space-y-2 text-gray-200">
              <li>Log in to your Canvas account</li>
              <li>Go to Account Settings (click on your profile picture)</li>
              <li>Scroll down to "Approved Integrations"</li>
              <li>Click "+ New Access Token"</li>
              <li>Enter a purpose (e.g., "Palette Integration")</li>
              <li>Set an expiration date (optional)</li>
              <li>Click "Generate Token"</li>
              <li>Copy the token immediately (it won't be shown again)</li>
            </ol>
          </div>

          <div>
            <label htmlFor="tokenInput" className="block text-sm font-medium text-gray-200 mb-2">
              Enter Your Canvas Personal Access Token:
            </label>
            <input
              id="tokenInput"
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !tokenLoginLoading) {
                  void handleTokenSubmit();
                }
              }}
              placeholder="Paste your Canvas token here..."
              className="w-full px-4 py-2 bg-gray-700 text-white border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500"
              disabled={tokenLoginLoading}
            />
          </div>

          <div className="flex gap-3 justify-end mt-6">
            <button
              onClick={() => {
                setShowTokenDialog(false);
                setTokenInput("");
                setTokenLoginLoading(false);
              }}
              className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={tokenLoginLoading}
            >
              Cancel
            </button>
            <button
              onClick={() => void handleTokenSubmit()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={tokenLoginLoading}
            >
              {tokenLoginLoading ? "Logging in..." : "Login"}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

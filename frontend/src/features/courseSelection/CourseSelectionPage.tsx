import { NoCourseSelected, Navbar } from "@/components";

export function CourseSelectionPage() {
  return (
    <>
      <Navbar />
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-gray-800 via-gray-900 to-gray-700">
        <NoCourseSelected />
      </div>
    </>
  );
}

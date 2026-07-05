import Foundation

struct NeXaAPIClient {
    func uploadRoomScan(
        _ payload: RoomPlanPayload,
        baseURL: String,
        projectId: String,
        username: String,
        password: String
    ) async throws -> RoomScanUploadResponse {
        let cleanBaseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !cleanBaseURL.isEmpty else {
            throw NeXaAPIError.missingBaseURL
        }

        let encodedProjectId = projectId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? projectId
        guard let url = URL(string: "\(cleanBaseURL)/api/takeoff-projects/\(encodedProjectId)/room-scans") else {
            throw NeXaAPIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Manager", forHTTPHeaderField: "x-hubflo-role")
        request.setValue(payload.actor, forHTTPHeaderField: "x-hubflo-employee-id")

        if !username.isEmpty || !password.isEmpty {
            let token = Data("\(username):\(password)".utf8).base64EncodedString()
            request.setValue("Basic \(token)", forHTTPHeaderField: "Authorization")
        }

        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw NeXaAPIError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(httpResponse.statusCode)"
            throw NeXaAPIError.server(message)
        }

        return try JSONDecoder().decode(RoomScanUploadResponse.self, from: data)
    }
}

struct RoomScanUploadResponse: Decodable {
    var imported: ImportedSummary

    struct ImportedSummary: Decodable {
        var rooms: Int
        var measurements: Int
    }
}

enum NeXaAPIError: LocalizedError {
    case missingBaseURL
    case invalidURL
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .missingBaseURL:
            return "Enter the NeXa web address before uploading."
        case .invalidURL:
            return "The NeXa web address is not valid."
        case .invalidResponse:
            return "NeXa did not return a valid response."
        case .server(let message):
            return "NeXa rejected the scan: \(message)"
        }
    }
}
